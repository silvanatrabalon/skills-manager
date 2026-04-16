# VS Code Skills Manager - Especificación Técnica

## Descripción General

**VS Code Skills Manager** es una extensión de Visual Studio Code que proporciona una interfaz gráfica intuitiva para gestionar skills utilizando la herramienta CLI `npx skills` de [vercel-labs/skills](https://github.com/vercel-labs/skills). La extensión permite configurar repositorios personalizados de skills (incluyendo repositorios propios) y administrarlos de manera visual, eliminando la necesidad de usar comandos CLI complejos.

### Objetivo

Crear una experiencia de usuario fluida y visual para:
- Descobrir y explorar skills disponibles
- Instalar/desinstalar skills con un solo click
- Configurar repositorios personalizados de skills
- Gestionar skills tanto a nivel global como de proyecto
- Visualizar el estado de todos los skills instalados

## Características Principales

### 1. Panel Principal de Skills
- **Vista en árbol** de todos los skills instalados (globales y de proyecto)
- **Indicadores visuales** del estado de cada skill (instalado, actualizable, error)
- **Categorización automática** por agente (Claude Code, Cursor, GitHub Copilot, etc.)
- **Búsqueda en tiempo real** con filtros por nombre, descripción y agente

### 2. Explorador de Skills
- **Navegador integrado** de repositorios de skills configurados
- **Vista previa** del contenido de SKILL.md antes de instalar
- **Filtros básicos** por nombre, descripción y agente compatible
- **Organización por categorías** según la estructura del repositorio

### 3. Gestión de Repositorios
- **Configuración múltiple** de repositorios de skills (GitHub, GitLab, locales)
- **Validación automática** de repositorios al agregarlos
- **Cache inteligente** para mejorar tiempo de respuesta
- **Sincronización automática** de actualizaciones

### 4. Comandos Integrados
Implementación gráfica de todos los comandos CLI:

#### Skills Management
- `skills.add` - Installar skills con UI de selección
- `skills.list` - Vista en árbol organizada
- `skills.find` - Búsqueda interactiva con preview
- `skills.update` - Actualización masiva con confirmaciones
- `skills.remove` - Desinstalación con warnings de dependencias
- `skills.init` - Crear nuevos skills con templates

### 5. Panel de Configuración
- **Configuración de agentes objetivo** (Claude, Cursor, etc.)
- **Gestión de rutas de instalación** (global vs proyecto)
- **Configuración de repositorios remotos**
- **Preferencias de actualización automática**
- **Configuración de telemetría y logging**

## Arquitectura Técnica

### Estructura de la Extensión

```
├── src/
│   ├── extension.ts              # Punto de entrada principal
│   ├── commands/                 # Comandos de VS Code
│   │   ├── skillsCommands.ts
│   │   ├── repositoryCommands.ts
│   │   └── configCommands.ts
│   ├── providers/                # Proveedores de datos
│   │   ├── skillsTreeProvider.ts
│   │   ├── repositoryProvider.ts
│   │   └── agentProvider.ts
│   ├── services/                 # Lógica de negocio
│   │   ├── skillsService.ts
│   │   ├── cliWrapper.ts
│   │   └── configService.ts
│   ├── ui/                       # Componentes de interfaz
│   │   ├── webviews/
│   │   │   ├── skillExplorer.ts
│   │   │   ├── skillDetail.ts
│   │   │   └── configuration.ts
│   │   └── dialogs/
│   │       ├── installDialog.ts
│   │       └── confirmDialog.ts
│   └── utils/                    # Utilidades
│       ├── fileSystem.ts
│       ├── gitUtils.ts
│       └── validation.ts
├── resources/                    # Recursos estáticos
│   ├── icons/
│   └── templates/
├── webview-ui/                   # UI en React/HTML
│   ├── src/
│   │   ├── components/
│   │   └── views/
│   └── package.json
└── package.json                  # Manifiesto de la extensión
```

### Componentes Clave

#### 1. CLI Wrapper Service
Encapsula todas las llamadas al CLI de skills:

```typescript
export class SkillsCliService {
  async addSkill(repository: string, options: AddSkillOptions): Promise<InstallResult>
  async listSkills(scope?: 'global' | 'project'): Promise<Skill[]>
  async findSkills(query?: string): Promise<SkillSearchResult[]>
  async updateSkills(skills?: string[]): Promise<UpdateResult[]>
  async removeSkills(skills: string[], options: RemoveOptions): Promise<RemoveResult>
  async initSkill(name: string, path?: string): Promise<void>
}
```

#### 2. Skills Tree Provider
Proveedor de datos para el árbol de skills en la sidebar:

```typescript
export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  getTreeItem(element: SkillTreeItem): vscode.TreeItem
  getChildren(element?: SkillTreeItem): Thenable<SkillTreeItem[]>
  refresh(): void
  // Métodos para manejar el estado del árbol
}
```

#### 3. Configuration Service
Manejo de configuración persistente:

```typescript
export class ConfigService {
  getRepositories(): Repository[]
  addRepository(repo: Repository): Promise<void>
  removeRepository(id: string): Promise<void>
  getAgentConfiguration(): AgentConfig
  updateAgentConfiguration(config: AgentConfig): Promise<void>
}
```

## Interfaz de Usuario

### 1. Sidebar Panel - "Skills Manager"
- **Vista en árbol** expandible por agente y categoría
- **Íconos contextuales** para cada tipo de skill y estado
- **Acciones rápidas** via context menu (install, update, remove, view)
- **Barra de búsqueda** integrada en la parte superior

### 2. Webview Principal - "Skills Explorer"
- **Grid de cards** para skills disponibles con preview
- **Panel lateral** con detalles del skill seleccionado
- **Botones de acción** prominent (Install, Update, Remove)
- **Filtros y ordenamiento** interactivo

### 3. Settings Panel
- **Tabs organizadas** por categoría (Repositories, Agents, Preferences)
- **Formularios intuitivos** para agregar repositorios
- **Switches y checkboxes** para configuraciones boolean
- **Validación en tiempo real** de URLs y paths

### 4. Dialogs y Modales
- **Install Confirmation** - Muestra detalles antes de instalar
- **Update Selection** - Permite elegir skills a actualizar
- **Repository Configuration** - Para agregar/editar repositorios

## Configuración del Usuario

### Package.json - Contribution Points

```json
{
  "contributes": {
    "commands": [
      {
        "command": "skills.explorer.show",
        "title": "Show Skills Explorer",
        "category": "Skills"
      },
      {
        "command": "skills.install.interactive",
        "title": "Install Skills...",
        "category": "Skills"
      },
      {
        "command": "skills.update.all",
        "title": "Update All Skills",
        "category": "Skills"
      }
    ],
    "views": {
      "skills-explorer": [
        {
          "id": "skills.tree",
          "name": "Installed Skills",
          "when": "workspaceHasPackageJson"
        },
        {
          "id": "skills.repositories",
          "name": "Repositories",
          "when": "workspaceHasPackageJson"
        }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "skills-explorer",
          "title": "Skills Manager",
          "icon": "$(extensions)"
        }
      ]
    },
    "configuration": {
      "title": "Skills Manager",
      "properties": {
        "skills.repositories": {
          "type": "array",
          "description": "List of skills repositories",
          "items": {
            "type": "object",
            "properties": {
              "id": {"type": "string"},
              "name": {"type": "string"},
              "url": {"type": "string"},
              "type": {"enum": ["github", "gitlab", "local"]}
            }
          },
          "default": []
        },
        "skills.defaultScope": {
          "type": "string",
          "enum": ["global", "project"],
          "default": "project",
          "description": "Default installation scope"
        },
        "skills.autoUpdate": {
          "type": "boolean",
          "default": false,
          "description": "Automatically update skills"
        },
        "skills.targetAgents": {
          "type": "array",
          "items": {"type": "string"},
          "description": "Default target agents for installations",
          "default": ["github-copilot", "claude-code", "cursor"]
        }
      }
    }
  }
}
```

## Flujos de Usuario

### 1. Primera Instalación
1. Usuario instala la extensión
2. Verificación automática de Skills CLI (instalación si no existe)
3. Dialog obligatorio para configurar primer repositorio de skills
4. Usuario configura URL/path de su repositorio personalizado
5. Se ejecuta sincronización inicial
6. Skills aparecen en el explorador

### 2. Instalar un Skill
1. Usuario abre Skills Explorer
2. Navega o busca skill deseado
3. Click en skill para ver detalles
4. Click en "Install"
5. Dialog de confirmación con opciones (scope, agents)
6. Progreso visual durante instalación
7. Confirmación de éxito y refresh del árbol

### 3. Gestionar Repositorios
1. Click en "+" en la sección Repositories
2. Dialog para agregar nuevo repositorio
3. Validación de URL/path en tiempo real
4. Test de conexión automático
5. Guardado y sincronización automática

## Consideraciones Técnicas

### Rendimiento
- **Lazy loading** de skills para repositorios grandes
- **Cache inteligente** de metadatos de skills
- **Debouncing** en búsquedas y filtros
- **Background sync** que no bloquee la UI

### Seguridad
- **Validación básica** de URLs de repositorios
- **Sandboxing** de ejecución de comandos CLI
- **Manejo seguro** de tokens de acceso para repositorios privados

### Compatibilidad
- **Instalación automática** del Skills CLI si no existe
- **Configuración manual** de agentes objetivo por el usuario
- **Soporte multi-plataforma** (Windows, macOS, Linux)
- **Versioning** compatible con semantic versioning del CLI

### Estado y Persistencia
- **Workspace state** para configuración por proyecto
- **Global state** para preferencias de usuario
- **Secrets storage** para tokens de acceso privados
- **Cache management** con expiración automática

## Métricas de Éxito

- **Adopción**: 1000+ instalaciones activas en 3 meses
- **Engagement**: Usuarios instalan promedio de 5+ skills
- **Satisfacción**: 4.5+ estrellas en VS Code Marketplace
- **Performance**: < 2s tiempo de carga inicial
- **Reliability**: < 1% error rate en operaciones principales

## Dependencias

### Runtime
- Node.js 16+
- VS Code 1.74+
- Git (para repositorios remotos)
- Skills CLI (npm package)

### Development
- TypeScript 4.8+
- esbuild para bundling (liviano y rápido)
- HTML/CSS/Vanilla JS para webviews (máxima simplicidad)
- VS Code Test Runner para testing
- ESLint/Prettier para code quality

---

**Autor**: [Tu Nombre]  
**Versión**: 1.0.0  
**Fecha**: Abril 2026  
**Status**: 🎯 SPEC READY FOR IMPLEMENTATION