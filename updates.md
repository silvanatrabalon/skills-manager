# Skills Update System — Análisis Completo

## 1. Cómo funciona el hash en el CLI

El CLI usa **dos sistemas de hash completamente diferentes** según el scope:

### 1.1 Global Lock (`~/.agents/.skill-lock.json`, v3)

```json
{
  "version": 3,
  "skills": {
    "deploy-to-vercel": {
      "source": "vercel-labs/agent-skills",
      "sourceType": "github",
      "sourceUrl": "https://github.com/vercel-labs/agent-skills.git",
      "skillPath": "skills/deploy-to-vercel/SKILL.md",
      "skillFolderHash": "1378aa506439f26c809dbcfc61515cbd70f93d69",
      "installedAt": "2026-04-20T21:43:45.300Z",
      "updatedAt": "2026-04-20T21:43:45.300Z"
    }
  }
}
```

- **`skillFolderHash`** = GitHub Tree SHA de la carpeta del skill en el repo remoto
- **`skillPath`** = Ruta al SKILL.md dentro del repo (ej: `skills/deploy-to-vercel/SKILL.md`)
- Se obtiene con `fetchSkillFolderHash()` → GitHub Trees API (`/git/trees/{branch}?recursive=1`)
- Busca el entry de tipo `tree` cuyo `path` coincida con la carpeta del skill
- Es un SHA de Git (40 chars hex), **determinístico basado en el estado de la carpeta en GitHub**

### 1.2 Local/Project Lock (`./skills-lock.json`, v1)

```json
{
  "version": 1,
  "skills": {
    "extension": {
      "source": "git@github.com:nike-internal/marketing-automation.lerna-publish.git",
      "sourceType": "git",
      "computedHash": "3cfa2bdd18d07d08549cce07f1c4538fdce56686f9bde9c21bbb38fa92e757f7"
    }
  }
}
```

- **`computedHash`** = SHA-256 del contenido de todos los archivos del skill en disco
- **NO tiene `skillPath`** ni `skillFolderHash`
- Se calcula con `computeSkillFolderHash(skillDir)`:
  1. Lee todos los archivos recursivamente
  2. Los ordena por path relativo
  3. Concatena `relativePath + content` de cada archivo
  4. Devuelve `SHA-256` hex digest
- Es un hash de **contenido local** (64 chars hex)

### 1.3 ⚠️ Son incompatibles

| Aspecto               | Global (`skillFolderHash`)          | Local (`computedHash`)                |
| ---------------------- | ----------------------------------- | ------------------------------------- |
| **Qué hashea**         | Carpeta remota en GitHub            | Archivos locales en disco             |
| **Algoritmo**          | Git SHA (40 chars)                  | SHA-256 (64 chars)                    |
| **Tiene skillPath?**   | ✅ SÍ (obligatorio para updates)    | ❌ NO                                 |
| **Se puede comparar?** | ✅ Sí, contra GitHub Trees API      | ❌ No contra nada remoto directamente |
| **Timestamps?**        | ✅ installedAt, updatedAt           | ❌ No                                 |

---

## 2. Cómo el CLI hace el check/update

### 2.1 Update de skills globales (`skills update -g`)

Archivo: `cli.ts` → `updateGlobalSkills()`

1. Lee `~/.agents/.skill-lock.json`
2. Filtra skills que tengan **AMBOS** `skillFolderHash` Y `skillPath`
3. Para cada skill checkeable:
   ```
   latestHash = fetchSkillFolderHash(source, skillPath, token)
   if (latestHash !== entry.skillFolderHash) → update disponible
   ```
4. Si hay update: ejecuta `skills add <source> -g -y` para reinstalar
5. El CLI automáticamente recalcula `skillFolderHash` durante la reinstalación

**Funciona porque:** Compara `skillFolderHash` (GitHub Tree SHA) contra el mismo tipo de hash remoto.

### 2.2 Update de skills locales (`skills update -p`)

Archivo: `cli.ts` → `updateProjectSkills()`

1. Lee `./skills-lock.json`  
2. Filtra skills (excluye `node_modules` y `local` sourceType)
3. **NO compara hashes**. Simplemente ejecuta `skills add <source> -y` para cada skill
4. La reinstalación recalcula `computedHash` desde los archivos en disco

**No necesita comparar hashes porque siempre re-instala.**

### 2.3 Conclusión clave

> El CLI **NO detecta updates para skills locales** — simplemente re-instala.  
> Solo detecta updates para skills **globales** que tengan `skillFolderHash` + `skillPath`.

---

## 3. Qué hace la extensión actualmente

### 3.1 Instalación (extension.ts → `skills.skill.install`)

Cuando el usuario selecciona **"Both"**, ejecuta DOS instalaciones separadas:

```
1. npx skills add <repo> --skill <name> --agent <agents> --yes          → escribe en skills-lock.json (computedHash)
2. npx skills add <repo> --global --skill <name> --agent <agents> --yes → escribe en .skill-lock.json (skillFolderHash)
```

Resultado: **mismo skill con dos formatos de hash diferentes en dos archivos**.

### 3.2 Check de updates (UpdateCheckService)

El servicio lee ambos lock files y procesa todos los skills.

**Problema actual:** Para skills de proyecto (con `computedHash` y sin `skillPath`), intentaba comparar contra commit hash del repo, lo cual:
- Compara hashes de tipos completamente diferentes
- Siempre dice que hay update disponible (falso positivo)

**Fix parcial aplicado:** Ahora skipea skills sin `skillPath`, pero eso hace que **nunca detecte updates para skills locales**.

### 3.3 Update de skills (extension.ts → `skills.skill.update`)

Ejecuta:
```
npx skills update <skillName> -g   (si scope === 'global')
npx skills update <skillName> -p   (si scope === 'project')
```

El CLI hace la reinstalación y actualiza el hash en el lock file correspondiente.

---

## 4. Problemas identificados

### P1: Skills globales con `skillFolderHash` vacío

Cuando se instala un skill desde un repo privado via SSH (`git@github.com:...`), el CLI **no puede obtener el `skillFolderHash`** porque:
- `fetchSkillFolderHash` necesita `owner/repo` para la API de GitHub
- El skill se instala vía `git clone` (no blob), y el clone path puede no tener `skillPath` correcto

Resultado: `skillFolderHash: ""` → no se puede chequear updates.

### P2: Skills locales no son chequeables

El lock local (`skills-lock.json`) solo tiene `computedHash`, que es un hash de contenido local. No hay forma de compararlo contra algo remoto sin reinstalar.

### P3: Deduplicación incorrecta

Cuando un skill está en ambos scopes, la deduplicación priorizaba el de proyecto (que tiene `computedHash`), descartando el global (que tiene `skillFolderHash`). Esto impedía detectar updates del skill.

### P4: El update no actualiza realmente el contenido

El usuario reportó que tras hacer click en "Update", el skill no se actualizaba. Esto puede ser porque:
- El CLI `skills update <name> -p` re-instala, pero la extensión no refleja los cambios
- O el comando falla silenciosamente

---

## 5. Diseño propuesto

### 5.1 Check de updates — Ambos scopes con skillFolderHash

Lógica unificada para global y local:

1. Leer el lock file correspondiente
2. Para cada skill, verificar si tiene `skillFolderHash` + `skillPath`
3. Si los tiene → comparar vs GitHub Trees API
4. Si no los tiene → intentar descubrirlos (fetch tree, buscar `skills/<name>/SKILL.md`)
   - Si descubre: guardar en el lock y comparar
   - Si no puede: skip (no checkeable)
5. Hash diferente → update disponible

### 5.2 Enriquecimiento del lock local

Tras cada instalación local exitosa:
1. Leer `skills-lock.json`
2. Para el skill recién instalado: fetch GitHub Trees API
3. Descubrir `skillPath` y obtener `skillFolderHash`
4. Agregar ambos campos al entry en `skills-lock.json`

Esto asegura que desde la primera instalación ya tenemos los datos para tracking.

### 5.3 Update de un skill

Cuando el usuario hace click en "Update":

- **Si es global:** `npx skills update <name> -g`
- **Si es local:** `npx skills update <name> -p`
- Tras éxito: re-calcular `skillFolderHash` y guardar en el lock correspondiente
  - Para global: el CLI ya lo hace automáticamente
  - Para local: la extensión lo hace (el CLI no lo guarda)

### 5.4 Deduplicación

Si un skill está en ambos scopes, mostrar update icon en AMBAS secciones si corresponde.
Ya no deduplicar — cada scope se trata independientemente.

### 5.5 Botón de update

- **Skills con `skillFolderHash` (global o local):** Mostrar botón si `hasUpdate === true`
- **Skills sin `skillFolderHash`:** Intentar descubrir al primer check; si no se puede, no mostrar botón

---

## 6. Cambios necesarios en el código

### 6.1 `updateCheckService.ts` — Unificar lógica para ambos scopes

```
checkSkillsFromLock():
  Para CADA skill (global o local):
  1. ¿Tiene skillFolderHash + skillPath válidos?
     → SÍ: comparar vs GitHub Trees API
     → NO: intentar descubrirlos (fetch tree, buscar carpeta del skill)
       → Si descubre: guardarlos en el lock y compararl
       → Si no puede descubrir: skip (no checkeable)
  
  Remover fetchRepoCommitHash() — no se usa más
  Remover lógica de computedHash como hash de comparación
```

### 6.2 Nuevo método: `enrichLocalLockEntry()`

```
Tras instalación o update de un skill local:
  1. Leer skills-lock.json
  2. Para el skill instalado: fetch repo tree → obtener skillPath + skillFolderHash
  3. Escribir los campos extra en skills-lock.json
```

### 6.3 `skillsTreeProvider.ts` — Update indicator para ambos scopes

```
Mostrar icon de update si:
  - hasUpdateAvailable(skill.name) === true
  - Aplica tanto a local como global
```

### 6.4 `extension.ts` — Post-install hook

```
Tras installación exitosa (cualquier scope):
  → Llamar enrichLocalLockEntry() para enriquecer el lock local
  → O si es global: el CLI ya guarda skillFolderHash, no hacer nada extra
```

### 6.5 `extension.ts` — Post-update hook

```
Tras update exitoso:
  → Re-calcular y guardar skillFolderHash + skillPath en el lock correspondiente
  → markSkillAsUpdated() + refreshAsync()
```

### 6.6 `cliWrapper.ts` — Mejorar parseUpdateResults

```
Mejor parsing del output del CLI update para saber si realmente se actualizó.
```

---

## 7. Flujo esperado (end-to-end)

### Instalación
```
User: Instala "extension" con scope "both"
  → npx skills add <repo> --skill extension --agent cursor --yes       → skills-lock.json (computedHash)
  → npx skills add <repo> --skill extension --global --agent cursor --yes → .skill-lock.json (skillFolderHash + skillPath)
  → [POST-INSTALL] Extensión enriquece skills-lock.json con skillFolderHash + skillPath

UI muestra:
  Installed Skills (2)
    This repo (1)
      extension ✓
    Global (1)
      extension ✓
```

### Check de updates
```
User: Ejecuta "Check for Updates"
  → Lee .skill-lock.json (global)
    → extension tiene skillFolderHash + skillPath → chequear con GitHub Trees API
  → Lee skills-lock.json (local)  
    → extension tiene skillFolderHash + skillPath (enriquecido) → chequear con GitHub Trees API
  → Ambos usan la misma lógica de comparación

UI muestra (si hay update):
  Installed Skills (2)
    This repo (1)
      extension 🔄 Update available
    Global (1)
      extension 🔄 Update available
```

### Update
```
User: Click "Update" en extension (This repo)
  → npx skills update extension -p
  → CLI reinstala, actualiza computedHash en skills-lock.json
  → [POST-UPDATE] Extensión re-calcula skillFolderHash y lo guarda en skills-lock.json
  → markSkillAsUpdated("extension")
  → refreshAsync()

UI muestra:
  Installed Skills (2)
    This repo (1)
      extension ✓   (actualizado)
    Global (1)
      extension 🔄 Update available   (aún pendiente, es independiente)
```

---

## 8. Tracking de updates para skills locales

### Estrategia: Enriquecer el lock local con `skillFolderHash` + `skillPath`

Aunque el CLI no guarda estos campos en `skills-lock.json`, **nosotros sí podemos hacerlo**:
- El CLI ignora campos extra al leer el lock — no rompe nada
- Si el CLI reescribe el lock (durante `add`/`update`), borra nuestros campos extras, pero los recalculamos justo después

### Flujo:

**Tras instalar un skill local:**
1. Leer `skills-lock.json` 
2. Normalizar `source` SSH → `owner/repo`
3. Fetch repo tree con GitHub Trees API (con token de VS Code)
4. Descubrir `skillPath` buscando `skills/<skillName>/SKILL.md` en el tree
5. Obtener `skillFolderHash` de esa carpeta en el tree
6. Escribir ambos campos en la entry del skill en `skills-lock.json`

**Resultado en `skills-lock.json`:**
```json
{
  "version": 1,
  "skills": {
    "extension": {
      "source": "git@github.com:org/repo.git",
      "sourceType": "git",
      "computedHash": "3cfa2bdd...",
      "skillFolderHash": "abc123...",
      "skillPath": "skills/extension/SKILL.md"
    }
  }
}
```

**Al chequear updates:**
- Si tiene `skillFolderHash` + `skillPath` → comparar vs GitHub Trees API (igual que global)
- Si no los tiene (skill recién instalado por CLI sin extensión) → intentar calcularlos

**Tras hacer update:**
- El CLI reescribe el lock (borra nuestros campos extra)
- La extensión recalcula `skillFolderHash` + `skillPath` y los reescribe

**Nota:** El campo `computedHash` del CLI sigue intacto — solo agregamos campos, no modificamos los existentes.

---

## 9. Caso especial: repos privados SSH

Cuando `source` es SSH (`git@github.com:org/repo.git`):
- El CLI hace `git clone` en vez de usar blob API
- **Puede que no calcule `skillFolderHash`** (resultado: `""`)
- **Puede que el `skillPath` sea incorrecto** (ej: apunta a otra skill)

### Evidencia del log:
```
"testing-update": {
  "skillFolderHash": "",        ← vacío!
  "skillPath": "skills/testing-update/SKILL.md"   ← tiene path pero no hash
}
"extension": {
  "skillFolderHash": "",        ← vacío!
  "skillPath": "skills/testing-update/SKILL.md"   ← ¡PATH INCORRECTO! apunta a testing-update
}
```

### Problema adicional:
El `skillPath` de "extension" apunta a `skills/testing-update/SKILL.md` — esto es un bug del CLI al descubrir skills. Pero como `skillFolderHash` está vacío, el check ya lo skipea.

### Solución para repos SSH:
Nuestro `UpdateCheckService` ya puede usar la VS Code authentication API para obtener un token de GitHub.
Con ese token, podemos llamar a `fetchSkillFolderHash()` directamente, incluso para repos privados.

**Plan:**
1. Si `skillFolderHash` es vacío pero tenemos `skillPath` → intentar calcular el hash nosotros
2. Usar `normalizeGitHubUrl()` para convertir SSH a `owner/repo`
3. Llamar `fetchSkillFolderHash(ownerRepo, skillPath, token)`
4. Si funciona: almacenar el hash calculado para comparaciones futuras

---

## 10. Preguntas abiertas de implementación

### Q1: ¿Cómo descubrir el `skillPath` correcto para un skill local?

El lock local no tiene `skillPath`. Necesitamos descubrirlo del repo tree.

**Opción A — Buscar por nombre:** En el tree, buscar `skills/<skillName>/SKILL.md`
- ✅ Simple
- ❌ Asume que la estructura del repo es `skills/<name>/SKILL.md`
- ❌ Puede fallar si el skill está en otra ubicación (ej: raíz, o subcarpeta diferente)

**Opción B — Buscar todos los SKILL.md:** En el tree, buscar todos los archivos que terminen en `SKILL.md`, y matchear por nombre de carpeta
- ✅ Más robusto
- ✅ Funciona con cualquier estructura de repo
- ❌ Un poco más complejo

**→ Decisión:** Usar Opción B. Buscar todos los `SKILL.md` en el tree, extraer el nombre de la carpeta padre, y matchear contra el `skillName`.

### Q2: ¿Qué pasa si el CLI borra nuestros campos extra al hacer `skills add` o `skills update`?

Verificar: ¿el CLI lee y reescribe todo el lock, o solo modifica la entry del skill?

**Del código del CLI (`local-lock.ts`):**
- `addSkillToLocalLock()` lee el lock completo, agrega/modifica una entry, y reescribe todo
- Al reescribir, usa los campos de `LocalSkillLockEntry` (source, ref, sourceType, computedHash)
- **Campos extra que no están en la interface se PIERDEN** al reescribir

**→ Confirmado:** El CLI borra nuestros campos. Esto es OK — los recalculamos tras cada add/update.

### Q3: ¿Dónde exactamente colocar el post-install hook?

En `extension.ts`, tras la llamada exitosa a `skillsService.installSkill()`:
```
const result = await skillsService.installSkill(repository, skillName, { scope: 'project' });
if (result.success) {
    // [POST-INSTALL HOOK AQUÍ]
    await updateCheckService.enrichLocalLock(skillName, source);
}
```

Igual tras update en `skills.skill.update`:
```
const results = await skillsService.updateSkills([skillName], skill.scope);
if (result?.success) {
    // [POST-UPDATE HOOK AQUÍ]  
    if (skill.scope === 'project') {
        await updateCheckService.enrichLocalLock(skillName, source);
    }
}
```

### Q4: ¿También enriquecemos el global lock cuando `skillFolderHash` está vacío?

Sí. Si el global lock tiene `skillFolderHash: ""` pero tiene `skillPath`, podemos:
1. Fetch el tree con nuestro token de VS Code
2. Calcular el hash
3. Escribirlo en `~/.agents/.skill-lock.json`

**Riesgo:** Estamos modificando el global lock que el CLI gestiona.
**Mitigación:** Solo agregamos un valor que estaba vacío. El CLI produciría el mismo valor si pudiera.

### Q5: ¿Qué pasa con skills de repos que NO son GitHub?

Si `source` no contiene `github.com` → no podemos usar GitHub Trees API → skip.
Esto ya está manejado por `isGitHubSkill()`.

---

## 11. Plan de pruebas por etapas

### Etapa 0: Limpieza previa
```
Acción:
  1. Desinstalar todos los skills (limpiar ambos locks)
  2. Verificar que ambos lock files están vacíos/sin skills
  3. Compilar extensión limpia

Verificar:
  ✓ UI muestra "Installed Skills (0)"
  ✓ No hay errores en consola
```

### Etapa 1: Instalar skill LOCAL + verificar enriquecimiento
```
Acción:
  1. Instalar un skill con scope "This repo" (local)
  2. Verificar que la extensión enriqueció skills-lock.json

Verificar:
  ✓ skills-lock.json tiene entry con: source, sourceType, computedHash (del CLI)
  ✓ skills-lock.json TAMBIÉN tiene: skillFolderHash, skillPath (de nuestra extensión)
  ✓ skillFolderHash es un SHA de 40 chars (no vacío)
  ✓ skillPath apunta al SKILL.md correcto del skill instalado
  ✓ UI muestra el skill en "This repo" con ✓
```

### Etapa 2: Instalar skill GLOBAL + verificar
```
Acción:
  1. Instalar un skill con scope "Global"
  2. Verificar .skill-lock.json

Verificar:
  ✓ .skill-lock.json tiene: skillFolderHash (del CLI, no vacío)
  ✓ .skill-lock.json tiene: skillPath correcto
  ✓ UI muestra el skill en "Global" con ✓
  ✓ Si skillFolderHash está vacío (repo SSH), la extensión lo calcula y lo escribe
```

### Etapa 3: Check updates — sin cambios en el repo
```
Acción:
  1. Ejecutar "Check for Updates" 
  2. No haber hecho ningún push al repo

Verificar:
  ✓ Log muestra que se chequearon AMBOS scopes
  ✓ Para cada skill: currentHash === latestHash
  ✓ UI muestra "All skills are up-to-date!"
  ✓ Ningún skill tiene icon de update
```

### Etapa 4: Pushear cambio + Check updates
```
Acción:
  1. Hacer un cambio en el SKILL.md del skill en el repo remoto
  2. Push al repo
  3. Ejecutar "Check for Updates"

Verificar:
  ✓ Log muestra que el hash cambió para el skill modificado
  ✓ UI muestra icon 🔄 en el skill que tiene update
  ✓ Los skills NO modificados siguen con ✓
  ✓ Si el skill está en ambos scopes, AMBOS muestran 🔄
```

### Etapa 5: Update skill LOCAL
```
Acción:
  1. Click "Update" en el skill bajo "This repo"
  2. Esperar a que termine

Verificar:
  ✓ CLI ejecutó: npx skills update <name> -p
  ✓ El contenido del SKILL.md en disco se actualizó (revisar archivo real)
  ✓ skills-lock.json: computedHash cambió (el CLI lo recalculó)
  ✓ skills-lock.json: skillFolderHash se actualizó (nuestra extensión lo recalculó post-update)
  ✓ UI: skill en "This repo" vuelve a ✓
  ✓ UI: skill en "Global" sigue con 🔄 (si aplica, es independiente)
```

### Etapa 6: Update skill GLOBAL
```
Acción:
  1. Click "Update" en el skill bajo "Global"
  2. Esperar a que termine

Verificar:
  ✓ CLI ejecutó: npx skills update <name> -g
  ✓ .skill-lock.json: skillFolderHash se actualizó (el CLI lo hace)
  ✓ UI: skill en "Global" vuelve a ✓
```

### Etapa 7: Re-check — todo limpio
```
Acción:
  1. Ejecutar "Check for Updates" de nuevo

Verificar:
  ✓ Todos los skills muestran currentHash === latestHash
  ✓ "All skills are up-to-date!"
  ✓ Ningún icon de update en UI
```

### Etapa 8: Edge case — CLI externo borra nuestros campos
```
Acción:
  1. Desde terminal (fuera de extensión): npx skills add <repo> --skill <name> --yes
  2. Verificar que skills-lock.json perdió skillFolderHash/skillPath
  3. Ejecutar "Check for Updates" desde la extensión

Verificar:
  ✓ La extensión detecta que faltan skillFolderHash/skillPath
  ✓ Los recalcula automáticamente
  ✓ Los guarda en skills-lock.json
  ✓ El check funciona correctamente
```
