# Alpha System - Content Hub (v2.0)

A NodeJS application for creating and managing documentation, changelogs, roadmaps, and knowledge base articles within distinct projects, using Markdown and powered by PocketBase.

## Features

- **🏢 Project Organization:** Group your content (entries, templates, assets) into separate projects.
- **📝 Rich Markdown Editing:** Create and manage content using a familiar Markdown editor (EasyMDE) with:
  - Toolbar assistance (bold, italic, lists, links, etc.)
  - 🖼️ Direct image uploads within the editor.
  - 📊 Diagram support using Mermaid syntax (flowcharts, sequence diagrams, etc.).
  - ✨ Grammar and style checking integration (via LanguageTool API).
  - 💾 Ctrl+S / Cmd+S shortcut for saving forms.
  - ⬇️ Download content as a Markdown file.
- **📄 Multiple Content Types:** Manage:
  - Documentation Articles
  - Changelog Entries
  - Roadmap Items
  - Knowledge Base Q&A
  - Sidebar Headers (for organizing public project sidebars)
- **🔄 Staging Workflow:** Make changes to published entries without affecting the live version. Publish staged changes explicitly when ready. View diffs between published and staged versions.
- **🔗 Preview Links:** Generate shareable, optionally password-protected preview links for draft or staged entries.
- **🎨 Custom Headers & Footers:** Create reusable HTML/CSS/JS headers and footers per project, specific to Documentation or Changelog entry types. Apply them to individual entries. Headers can be sticky.
- **📄 Templates (Per-Project):** Define reusable Markdown templates within each project for consistent entry structure. Apply templates when creating new entries.
- **🗺️ Roadmap Management:** Create and manage roadmap items with distinct stages (Planned, Next Up, In Progress, Done) per project.
- **📊 Public Roadmap Board:** Automatically generated public Kanban-style board view for each project's roadmap (`/roadmap/:projectId`).
- **🧠 Knowledge Base Management:** Create and manage question/answer pairs within projects.
- **💡 Public Knowledge Base View:** Automatically generated, searchable public view for each project's knowledge base (`/kb/:projectId`).
- **↔️ Sidebar Ordering (Per-Project):** Drag-and-drop interface to control the order of entries and headers shown in the public project sidebar.
- **📤 Export Projects:** Export entire projects including entries, templates, and assets for backup or transfer.
- **📥 Import Projects:** Import previously exported projects to restore or migrate content seamlessly.
- **🖥️ Admin Dashboards:**
  - Global dashboard for an overview across all projects.
  - Per-project dashboard with specific metrics and activity charts (using ApexCharts).
- **🔒 Secure Access:** Dashboard access is protected by PocketBase user authentication. Project access is controlled per user.
- **🔑 Project Access Control:** Projects can be made public or private, with optional password protection for public projects.
- **⚙️ Project Settings:** Configure project name, description, visibility, password, and feature enablement (Roadmap, View Tracking, Time Tracking, Full Width Content).
- **👁️ View Tracking:** Basic view counts are recorded for each public entry page using SQLite and privacy-preserving IP hashing. Configurable per project.
- **⏱️ View Time Tracking:** Optionally track approximate time spent on public documentation and changelog pages. Configurable per project. Requires View Tracking to be enabled.
- **👍 Feedback Mechanism:** Simple "Was this helpful?" (Yes/No) voting system on public entry pages. Results visible on project dashboard.
- **🚀 Pocketbase Backend:** Leveraging the speed and simplicity of Pocketbase for data storage and user authentication.
- **📄 Public View Pages:** Automatically generated, styled pages for customers to view published entries (`/view/:id`), respecting project visibility, password settings, and custom headers/footers.
- **⚙️ Configurable:** Uses environment variables (`.env`) and dynamic application settings stored in PocketBase (`app_settings` collection).
- **🔍 Global Search:** Search across all entries (title, collection, tags) accessible to the logged-in user (if enabled in settings).
- **📜 Audit Log:** Tracks key system and user actions globally (if enabled in settings). Viewable in the admin UI and exportable to CSV.
- **🗄️ Archiving:** Archive entries instead of permanently deleting them. View and manage archived entries per project/type.
- **💼 File Management:** Basic overview page for files uploaded via the editor (size calculation optional).
- **🌗 Light & Dark Themes:** Choose your preferred viewing mode for the admin interface. Theme preference is saved per user.
- **✨ Graceful Shutdown:** Handles `SIGINT` to close database connections and the server properly.

## Preview & Changelog

You can see a public page example [here](https://docs.alphasystem.dev/view/contenthubmarkd).

You can see the changelog [here](https://docs.alphasystem.dev/view/changelogsystem).

## Tech Stack

- **Backend:** NodeJS, Express
- **Templating:** EJS
- **Database:** PocketBase
- **Session Store:** SQLite (`connect-sqlite3`)
- **View Tracking Store:** SQLite (`sqlite3`)
- **Markdown Editor:** EasyMDE
- **Markdown Parsing:** Marked.js
- **HTML Sanitization:** DOMPurify
- **Diagrams:** Mermaid
- **Dashboard Charts:** ApexCharts
- **Drag & Drop:** SortableJS
- **Styling:** Vanilla CSS

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js:** Version 18 or higher recommended. ([Download Node.js](https://nodejs.org/))
- **npm:** Usually included with Node.js.
- **Git:** For cloning the repository. ([Download Git](https://git-scm.com/))
- **A running PocketBase instance:**
  - Download and run PocketBase from [pocketbase.io](https://pocketbase.io/).
  - Note the URL where it's running (e.g., `http://127.0.0.1:8090`).

## Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/devAlphaSystem/Alpha-System-ContentHub.git
    cd Alpha-System-ContentHub
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

## Configuration

Configuration is managed through a `.env` file in the project root.

1.  **Create `.env` and fill in the values:**

    ```dotenv
    # --- Required ---
    # PocketBase instance URL
    POCKETBASE_URL=http://127.0.0.1:8090

    # Credentials for an ADMIN/SUPERUSER account in PocketBase (used for setup script & admin tasks)
    POCKETBASE_ADMIN_EMAIL=your_admin_email@example.com
    POCKETBASE_ADMIN_PASSWORD=your_admin_password

    # Generate strong, random strings for these secrets!
    SESSION_SECRET=your-very-strong-random-secret-key-here
    IP_HASH_SALT=another-very-strong-random-secret-for-hashing-ips

    # Record ID of the single record in the 'app_settings' collection in PocketBase
    # IMPORTANT: Get this ID AFTER running the `node build_pb.js` setup script!
    APP_SETTINGS_RECORD_ID=YOUR_APP_SETTINGS_RECORD_ID_HERE

    # --- Optional ---
    # Set to "production" for production environments, otherwise "development"
    NODE_ENV=development

    # Port for the NodeJS application to run on
    PORT=3000

    # Log level: NONE < ERROR < WARN < INFO < DEBUG < TRACE
    LOG_LEVEL=INFO

    # Default items per page in tables
    ITEMS_PER_PAGE=10

    # Session duration in days
    SESSION_MAX_AGE_DAYS=7

    # Default expiry for preview links (hours) - Can be overridden in App Settings UI
    PREVIEW_TOKEN_EXPIRY_HOURS=6

    # Default for Global Search feature - Can be overridden in App Settings UI
    ENABLE_GLOBAL_SEARCH=true

    # Default for Audit Log feature - Can be overridden in App Settings UI
    ENABLE_AUDIT_LOG=true

    # Default for View Tracking on new projects - Can be overridden in App Settings UI
    ENABLE_PROJECT_VIEW_TRACKING_DEFAULT=true

    # Default for View Time Tracking on new projects - Can be overridden in App Settings UI
    ENABLE_PROJECT_TIME_TRACKING_DEFAULT=true

    # Default for Full Width Content on new projects - Can be overridden in App Settings UI
    ENABLE_PROJECT_FULL_WIDTH_DEFAULT=false

    # Default for File Size Calculation on Files page - Can be overridden in App Settings UI
    ENABLE_FILE_SIZE_CALCULATION=true

    # How long (hours) before a view from the same IP is counted again
    VIEW_TIMEFRAME_HOURS=24

    # Average words per minute used for reading time calculation
    AVERAGE_WPM=225
    ```

2.  **Configure PocketBase Collections (Automated Setup):**

    This project includes a script to automatically set up the required PocketBase collections using an exported schema definition (`pb_schema.json`). **This is the recommended way to set up the database structure.**

    **Prerequisites for Automated Setup:**

    - Your PocketBase instance must be running at the `POCKETBASE_URL` specified in your `.env` file.
    - The `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` in your `.env` file must correspond to a valid **Admin/Superuser** account in your PocketBase instance.
    - The `pb_schema.json` file (containing the collection definitions provided in this repository) must be present in the project root directory.
    - Node.js dependencies must be installed (`npm install`).

    **Running the Setup Script:**

    - Open your terminal in the project root directory (`Alpha-System-ContentHub`).
    - Run the command:
      ```bash
      node build_pb.js
      ```
    - The script will connect to your PocketBase instance, authenticate as the admin user, and attempt to import the collections defined in `pb_schema.json`. It will skip collections that already exist by name.
    - **CRITICAL STEP:** After the script runs successfully, **note the Record ID** printed for the `app_settings` collection. You **must** copy this ID and paste it into your `.env` file as the value for `APP_SETTINGS_RECORD_ID`.
    - Review the script's output for any errors. If errors occur, ensure PocketBase is running and accessible, and admin credentials are correct. If collections were partially created, you might need to manually delete them from the PocketBase Admin UI (`http://YOUR_POCKETBASE_URL/_/`) before re-running the script.

3.  **Configure `users` Collection (Manual Step):**

    You still need to configure the default `users` collection for application login:

    - Navigate to your PocketBase Admin UI (e.g., `http://127.0.0.1:8090/_/`).
    - Go to `users` collection > Options > Identity/Password.
    - Ensure **"Identity/Password"** is **ENABLED**.
    - You might want to disable **"Send email alert for new logins"** to avoid error logs if email is not configured in PocketBase.
    - Create at least one **non-admin user** account via the UI. This user account will be used to log into the Content Hub application itself.

## Running the Application

1.  **Ensure PocketBase is running** and the collections have been configured (using `node build_pb.js`) and the `APP_SETTINGS_RECORD_ID` is set in `.env`.
2.  **Start the Node.js application:**

    - **Development Mode (with automatic restarts using `nodemon`):**

      ```bash
      npm run dev
      ```

    - **Production Mode:**

      ```bash
      npm start
      ```

3.  **Access:**
    Open your browser and navigate to `http://localhost:3000` (or the port specified in your `.env` file). Log in using the **non-admin user** credentials you created in PocketBase.

## Usage

1.  Navigate to the application URL and log in using your PocketBase **user** credentials.
2.  **Global Dashboard (`/`):** View an overview across all your projects, including recent activity and top entries. Check for application updates.
3.  **Projects (`/projects`):** View, search, and manage your projects. Create new projects.
4.  **Project Dashboard (`/projects/:projectId`):** View project-specific metrics (views, entry counts, feedback scores), activity charts, and recently updated entries. Access project settings.
5.  **Project Entries (`/projects/:projectId/documentation`, `/changelogs`, `/roadmaps`, `/knowledge_base`):** View, filter (by collection, search term), sort, and manage entries for the specific project and type. Perform actions like Archive, Delete, or Publish Staged Changes. Initiate bulk actions (Archive, Delete).
6.  **Create New Entry (`/projects/:projectId/new`):** Create a new entry within a project. Select type (Doc, Changelog, Roadmap, KB), use the Markdown editor (with image uploads, Mermaid, grammar check), apply optional project templates, and select optional custom headers/footers (type-specific). Assign Roadmap stage if applicable. Optionally set a custom 15-char ID.
7.  **Edit Entry (`/projects/:projectId/edit/:entryId`):** Modify an existing entry.
    - If the entry is published, changes are staged by default. You can view a diff or preview the staged version.
    - Select optional custom headers/footers.
    - Generate shareable preview links for drafts or staged changes.
    - Use the grammar check tool.
    - Duplicate the entry as a new draft.
8.  **Archived Entries (Per-Project, Per-Type):** View archived entries for the project/type. Unarchive or permanently delete them.
9.  **Templates (Per-Project) (`/projects/:projectId/templates`):** Create, view, edit, and delete reusable Markdown templates specific to the project.
10. **Headers/Footers (Per-Project, Per-Type):** Create, view, edit, and delete reusable HTML/CSS/JS headers/footers for Documentation and Changelog entries within the project.
11. **Sidebar Order (Per-Project) (`/projects/:projectId/sidebar-order`):** Drag and drop to reorder entries and special "Sidebar Header" items shown in the public project sidebar. Add, edit, or delete headers.
12. **Global Audit Log (`/audit-log`):** View a log of system and user actions across all projects (if enabled). Export to CSV or clear logs.
13. **System Settings (`/settings`):** Configure global application settings like Audit Log enablement, Global Search, default project settings, and bot user agents for view tracking.
14. **Global Search (`/search?q=...` or via top bar):** Search across all entries you have access to (if enabled).
15. **File Management (`/files`):** View a list of all uploaded files across your projects. Optionally calculate total storage size. Delete individual files.
16. **Public View (`/view/:id`):** Access the public page for a published entry (respects project visibility/password). Includes TOC, code copying, heading links, feedback buttons.
17. **Public Roadmap (`/roadmap/:projectId`):** Access the public roadmap board for a project (respects project visibility/password and roadmap feature enablement).
18. **Public Knowledge Base (`/kb/:projectId`):** Access the public knowledge base for a project (respects project visibility/password). Includes search/filter functionality.
19. **Preview (`/preview/:token`):** Access a draft or staged entry using a generated preview link (may require a password).
20. **Theme Toggle:** Use the toggle in the sidebar footer to switch between light and dark modes for the admin interface.
21. **Save Shortcut:** Use `Ctrl+S` (or `Cmd+S`) on Create/Edit pages (Entries, Templates, Headers, Footers, Settings) to save the form.

## Notes

- **Session Storage:** Uses `connect-sqlite3` storing sessions in `db/sessions.db`. Consider alternatives (Redis, PostgreSQL) for high-traffic production.
- **View Tracking:** Uses `sqlite3` storing view logs and duration data in `db/view_tracking.db`. Hashing IPs enhances privacy but review GDPR/LGPD compliance if applicable. Bot detection uses user agent strings defined in App Settings.
- **Error Handling:** Basic error pages (403, 404, 500) are included. Check server logs (`stdout` or configured log output) for detailed errors based on `LOG_LEVEL`.
- **Admin Client:** The application uses a PocketBase admin client internally for certain operations (like setup, cleanup, some lookups, audit logging, cron jobs). Ensure the admin credentials in `.env` are kept secure and the PocketBase instance is accessible.
- **Cron Jobs:** Background jobs run hourly (by default) to clean up expired and orphaned preview tokens. Ensure the Node process stays running for these to execute.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

## Donations

Bitcoin - bc1qvl96wktx24ansqpgq7em7eqw2azkue6pltuga2

Ethereum - 0x517b5fA372793d878C063DCEa2286AA2307D2Ebf

XRP - rsASHgirdZdgSjAuQncg4Nc2PqPFNkjTCz

Dogecoin - DHt2KKtrzsyxvPv1QADLzh1xwxTiiW7iEK

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
