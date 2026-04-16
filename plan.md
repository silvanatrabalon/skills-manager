# 🚀 Skills Manager - Plan de Funcionalidades

## 📋 Overview
Plan de implementación de nuevas funcionalidades para mejorar la experiencia de usuario y añadir capacidades avanzadas de gestión de skills.

---

## 1. 🔒 **Deshabilitar Telemetría**

### **Problema**
Skills CLI envía telemetría anónima por defecto. Queremos deshabilitar esto para todos los comandos.

### **Solución**
- Establecer variable de entorno `DISABLE_TELEMETRY=true` antes de cada comando CLI
- Modificar `cliWrapper.ts` para incluir esta variable en todas las ejecuciones

### **Implementación**
```typescript
// En runCommand:
const options = {
    shell: true,
    env: { 
        ...process.env, 
        PATH: fullPath,
        DISABLE_TELEMETRY: 'true'  // ← Nueva variable
    }
};
```

### **Impacto**
- ✅ Mayor privacidad para los usuarios
- ✅ Comandos más rápidos (sin envío de datos)
- ✅ Transparente para el usuario

---

## 2. 🎯 **Selección de Scope (Local vs Global)**

### **Problema Actual**
La instalación siempre usa scope "project" por defecto. Necesitamos UI para elegir between local/global.

### **Nueva UI Propuesta**

#### **2.1 Quick Pick para Instalación**
Cuando el usuario hace click en "Install Skill":
```
┌─ Install Skill: web-design-guidelines ─────────────┐
│ Choose installation scope:                          │
│ ○ Local (Project only)                             │
│ ● Global (Available in all projects)               │
│ ○ Both (Local + Global)                            │
└─────────────────────────────────────────────────────┘
```

#### **2.2 Comandos Resultantes**
```bash
# Local
npx skills add [REPO] -a cursor --yes

# Global  
npx skills add [REPO] -a cursor --yes -g

# Both (ejecutar ambos comandos)
npx skills add [REPO] -a cursor --yes
npx skills add [REPO] -a cursor --yes -g
```

### **Implementación**
1. Crear `ScopeSelectionDialog` component
2. Modificar `skillInstallCommand` para mostrar dialog antes de instalar
3. Pasar selección a `installSkill` method
4. Actualizar `cliWrapper.addSkill` para manejar scope

---

## 3. 👥 **Selección Múltiple de Agentes**

### **Problema Actual**
Solo instala para agentes hardcoded ('cursor'). Necesitamos UI para elegir múltiples agentes.

### **Nueva UI Propuesta**

#### **3.1 Multi-Select para Agentes**
```
┌─ Select Target Agents ─────────────────────────────┐
│ Choose which agents to install this skill for:     │
│ ☑ cursor                                           │
│ ☐ github-copilot                                   │
│ ☐ opencode                                         │
│ ☐ claude-code                                      │
│ ☐ antigravity                                      │
│ ☐ codex                                            │
│                                                    │
│ [ Cancel ] [ Install Selected ]                    │
└─────────────────────────────────────────────────────┘
```

#### **3.2 Comando Resultante**
```bash
npx skills add [REPO] -a cursor -a github-copilot -a claude-code --yes
```

### **Implementación**
1. Crear `AgentSelectionDialog` con checkboxes
2. Guardar agentes preferidos en configuración del usuario
3. Pre-seleccionar agentes basado en preferencias
4. Construir comando dinámicamente con agentes seleccionados

---

## 4. 📂 **Skills Tree Scope-Aware**

### **Problema Actual**
Solo muestra skills sin distinguir entre local/global.

### **Nueva Estructura Propuesta**
```
Skills Manager
├── 📁 Installed Skills
│   ├── 🏠 Local (Project)
│   │   ├── ✅ web-design-guidelines
│   │   └── ✅ deploy-to-vercel  
│   └── 🌍 Global (All Projects)
│       ├── ✅ vercel-composition-patterns
│       └── ✅ vercel-cli-with-tokens
└── 📁 Available Skills
    ├── 📦 vercel-react-best-practices
    └── 📦 vercel-react-native-skills
```

### **Implementación**
1. Modificar `listSkills()` para ejecutar ambos comandos:
   - `npx skills ls` (local)
   - `npx skills ls -g` (global)
2. Actualizar `SkillsTreeProvider` para crear estructura anidada
3. Agregar iconos distintivos para local vs global
4. Context menus diferentes según scope

---

## 5. 🗑️ **Removal Scope-Aware**

### **Nueva Funcionalidad**
Context menu inteligente que detecta dónde está instalado el skill:

```
Right-click en skill:
├── 📋 Show Details
├── 🗑️ Remove from Local    (si está en local)
├── 🗑️ Remove from Global   (si está en global)  
├── 🗑️ Remove from Both     (si está en ambos)
└── 🔄 Update Skill
```

### **Comandos**
```bash
# Remove local
npx skills remove skill-name --yes

# Remove global  
npx skills remove skill-name --yes -g

# Remove both (ejecutar ambos comandos)
```

---

## 6. 🔄 **Update Functionality**

### **Nueva Funcionalidad**
- Context menu "Update Skill" en installed skills
- Comando: `npx skills update skill-name -y`
- Progress notification durante update
- Refresh automático después de update

### **Implementación**
```typescript
async updateSkill(skillName: string, scope: 'local' | 'global'): Promise<UpdateResult> {
    const args = ['npx', 'skills', 'update', skillName, '-y'];
    if (scope === 'global') {
        args.push('-g');
    }
    // Execute and return result
}
```

---

## 7. ⚙️ **Configuration Enhancements**

### **Nuevas Configuraciones**
```json
{
    "skills.defaultScope": "local",           // local | global | both
    "skills.preferredAgents": [               // Pre-select these agents
        "cursor", 
        "github-copilot"
    ],
    "skills.telemetryDisabled": true,         // Always disable telemetry
    "skills.autoRefreshAfterInstall": true    // Auto refresh UI
}
```

---

## 8. 📊 **Implementation Priority**

### **Phase 1: Core Functionality**
1. ✅ Telemetry disable (Easy win)
2. ✅ Scope selection dialog
3. ✅ Agent multi-select dialog

### **Phase 2: UI Improvements**  
4. ✅ Scope-aware skills tree
5. ✅ Context-aware removal
6. ✅ Update functionality

### **Phase 3: Polish**
7. ✅ Enhanced configurations
8. ✅ Better error handling
9. ✅ Progress indicators

---

## 9. 🎨 **UI Mockups**

### **Install Dialog Flow**
```
[Click Install] 
    ↓
[Scope Selection: Local/Global/Both]
    ↓  
[Agent Selection: Multiple checkboxes]
    ↓
[Execute Command(s)]
    ↓
[Progress Notification]
    ↓
[Success + Auto Refresh]
```

### **Skills Tree Enhanced**
```
🎯 Skills Manager
├── 📊 Installed Skills (4)
│   ├── 🏠 Local (2)
│   │   ├── ✅ web-design-guidelines     [Update] [Remove Local]
│   │   └── ✅ deploy-to-vercel         [Update] [Remove Local]
│   └── 🌍 Global (3) 
│       ├── ✅ composition-patterns     [Update] [Remove Global]
│       └── ✅ cli-with-tokens         [Update] [Remove Global]
└── 📦 Available Skills (3)
    ├── 📦 react-best-practices         [Install...]
    └── 📦 react-native-skills          [Install...]
```

---

## 🎯 **Success Metrics**

### **User Experience**
- ✅ Zero configuration needed for privacy (telemetry off)
- ✅ Clear choice between local/global installation  
- ✅ Multi-agent support with easy selection
- ✅ Visual distinction between local/global skills
- ✅ Context-aware actions (remove, update)

### **Technical**
- ✅ All CLI commands properly scoped
- ✅ Efficient caching of local vs global skills
- ✅ Robust error handling for all scenarios
- ✅ Performance optimized (minimal CLI calls)

---

## 🚀 **Ready to Implement?**

¿Por cuál funcionalidad quieres empezar? Suggiero:

1. **Telemetry disable** - Quick win, 5 minutos
2. **Scope selection dialog** - Core UX improvement
3. **Agent multi-select** - Power user feature

¿Cuál prefieres que implementemos primero? 🤔