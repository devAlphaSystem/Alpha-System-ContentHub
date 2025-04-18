![](https://db.alphasystem.dev/api/files/pbc_3165375535/contenthubmarkd/contenthub_logo_bmf7hxuvle.png)

# Alpha System - Content Hub (v2.0)

A simple NodeJS application for creating and managing documentation, changelogs, and roadmaps within distinct projects, using Markdown and powered by PocketBase.

## Features

- **🏢 Project Organization:** Group your content (entries, templates, assets) into separate projects.
- **📝 Markdown Editing:** Create and manage content using a familiar Markdown editor (EasyMDE) with toolbar assistance and Ctrl+S saving.
- **🖥️ Admin Dashboard:** Central dashboards for global overview and per-project management. View, create, edit, archive, and manage entries within their projects.
- **🎨 Custom Headers & Footers (Per-Project, Per-Type):** Create reusable HTML headers/footers specific to each project and entry type (Documentation, Changelog) for customized public view pages.
- **📄 Templates (Per-Project):** Define reusable Markdown templates within each project for consistent entry structure.
- **🗺️ Roadmap Management:** Create and manage roadmap items with distinct stages (Planned, Next Up, In Progress, Done) per project.
- **📊 Public Roadmap Board:** Automatically generated public Kanban-style board view for each project's roadmap.
- **🔒 Secure Access:** Dashboard access is protected by PocketBase user authentication. Project access is controlled per user.
- **🔑 Project Access Control:** Projects can be made public or private, with optional password protection for public projects.
- **⚙️ Project Settings:** Configure project name, description, visibility, password, and roadmap feature enablement.
- **↔️ Sidebar Ordering (Per-Project):** Drag-and-drop interface to control the order of entries shown in the public project sidebar.
- **🌗 Light & Dark Themes:** Choose your preferred viewing mode for the admin interface.
- **👁️ View Tracking:** Basic view counts are recorded for each public entry page using SQLite and privacy-preserving IP hashing.
- **🚀 Pocketbase Backend:** Leveraging the speed and simplicity of Pocketbase for data storage.
- **📄 Public View Pages:** Automatically generated, styled pages for customers to view published entries (`/view/:id`) and roadmaps (`/roadmap/:projectId`), respecting project visibility and password settings.
- **⚙️ Configurable:** Uses environment variables for easy setup.
- **🔍 Audit Log:** Tracks key actions performed within the application globally.
- **🔄 Staging:** Make changes to published entries without affecting the live version until you explicitly publish the staged changes.
- **🔗 Preview Links:** Generate shareable, optionally password-protected preview links for draft entries.
- **🖼️ Image Uploads:** Directly upload images within the Markdown editor for entries.
- **📊 Diagram Support:** Embed and render various diagrams (flowcharts, sequence, Gantt, etc.) directly within your Markdown content using Mermaid syntax.

## Preview

You can see a public page example [here](https://docs.alphasystem.dev/view/contenthubmarkd).

## Changelog

You can see the changelog [here](https://docs.alphasystem.dev/view/changelogsystem).

## Tech Stack

- **Backend:** NodeJS, Express
- **Templating:** EJS
- **Database:** PocketBase
- **Session Store:** SQLite (`connect-sqlite3`)
- **View Tracking Store:** SQLite (`sqlite3`)
- **Markdown Editor:** EasyMDE
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
      # PocketBase instance URL
      POCKETBASE_URL=http://127.0.0.1:8090

      # Credentials for an ADMIN/SUPERUSER account in PocketBase (used for setup script)
      POCKETBASE_ADMIN_EMAIL=your_admin_email@example.com
      POCKETBASE_ADMIN_PASSWORD=your_admin_password

      # Set to "production" for production environments, otherwise "development"
      NODE_ENV=development

      # Port for the NodeJS application to run on
      PORT=3000

      # Generate strong, random strings for these secrets!
      SESSION_SECRET=your-very-strong-random-secret-key-here
      IP_HASH_SALT=another-very-strong-random-secret-for-hashing-ips

      # Can be: NONE < ERROR < WARN < INFO < DEBUG < TRACE
      LOG_LEVEL=INFO # Default if not present
    ```

2.  **Configure PocketBase Collections (Automated Setup):**

    This project includes a script to automatically set up the required PocketBase collections using an exported schema definition (`pb_schema.json`). **This is the recommended way to set up the database structure.**

    **Prerequisites for Automated Setup:**

    - Your PocketBase instance must be running at the `POCKETBASE_URL` specified in your `.env` file.
    - The `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` in your `.env` file must correspond to a valid **Admin/Superuser** account in your PocketBase instance.
    - The `pb_schema.json` file (containing the collection definitions) must be present in the project root directory.
    - Node.js dependencies must be installed (`npm install`).

    **Running the Setup Script:**

    - Open your terminal in the project root directory (`Alpha-System-ContentHub`).
    - Run the command:
      ```bash
        node build_pb.js
      ```
    - The script will connect to your PocketBase instance, authenticate as the admin user, and attempt to import the collections defined in `pb_schema.json`. It will skip collections that already exist by name.
    - Review the script's output for any errors. If errors occur, ensure PocketBase is running and accessible, and admin credentials are correct. If collections were partially created, you might need to manually delete them from the PocketBase Admin UI (`http://YOUR_POCKETBASE_URL/_/`) before re-running the script.

3.  **Configure `users` Collection (Manual Step):**

    You still need to configure the default `users` collection for application login:

    - Navigate to your PocketBase Admin UI (e.g., `http://127.0.0.1:8090/_/`).
    - Go to `users` collection > Options > Identity/Password.
    - Ensure **"Identity/Password"** is **ENABLED**.
    - You might want to disable **"Send email alert for new logins"** to avoid error logs if email is not configured in PocketBase.
    - Create at least one **non-admin user** account via the UI. This user account will be used to log into the Content Hub application itself.

## Running the Application

1.  **Ensure PocketBase is running** and the collections have been configured (using `node build_pb.js`).
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
2.  **Global Dashboard (`/`):** View an overview across all your projects.
3.  **Projects (`/projects`):** View, search, and manage your projects. Create new projects.
4.  **Project Dashboard (`/projects/:projectId`):** View project-specific metrics and recently updated entries. Access project settings.
5.  **Project Entries (`/projects/:projectId/documentation`, `/changelogs`, `/roadmaps`):** View, filter, sort, and manage entries (Docs, Changelogs, Roadmap items) for the specific project. Perform actions like Archive, Delete, or Publish Staged Changes. Initiate bulk actions.
6.  **Create New Entry (`/projects/:projectId/new`):** Create a new entry within a project. Select type (Doc, Changelog, Roadmap), use the Markdown editor, apply optional project templates, and select optional custom headers/footers (type-specific). Assign Roadmap stage if applicable.
7.  **Edit Entry (`/projects/:projectId/edit/:entryId`):** Modify an existing entry. If the entry is published, changes are staged by default. Select optional custom headers/footers. Generate preview links for drafts.
8.  **Archived Entries (Per-Project, Per-Type):** View archived entries for the project/type. Unarchive or permanently delete them.
9.  **Templates (Per-Project) (`/projects/:projectId/templates`):** Create, view, edit, and delete reusable Markdown templates specific to the project.
10. **Headers/Footers (Per-Project, Per-Type):** Create, view, edit, and delete reusable HTML headers/footers for Documentation and Changelog entries within the project.
11. **Sidebar Order (Per-Project) (`/projects/:projectId/sidebar-order`):** Drag and drop to reorder entries shown in the public project sidebar.
12. **Global Audit Log (`/audit-log`):** View a log of system and user actions across all projects. Export or clear logs.
13. **Public View (`/view/:id`):** Access the public page for a published entry (respects project visibility/password).
14. **Public Roadmap (`/roadmap/:projectId`):** Access the public roadmap board for a project (respects project visibility/password and roadmap feature enablement).
15. **Preview (`/preview/:token`):** Access a draft entry using a generated preview link (may require a password).
16. **Theme Toggle:** Use the toggle in the sidebar to switch between light and dark modes for the admin interface.
17. **Save Shortcut:** Use `Ctrl+S` (or `Cmd+S`) on Create/Edit pages (Entries, Templates, Headers, Footers) to save the form.

## Notes

- **Session Storage:** Uses `connect-sqlite3` storing sessions in `db/sessions.db`. Consider alternatives (Redis, PostgreSQL) for high-traffic production.
- **View Tracking:** Uses `sqlite3` storing view logs in `db/view_tracking.db`. Hashing IPs enhances privacy but review GDPR/LGPD compliance if applicable.
- **Error Handling:** Basic error pages (403, 404, 500) are included. Check server logs for detailed errors.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

## Donations

Bitcoin - bc1qvl96wktx24ansqpgq7em7eqw2azkue6pltuga2

Ethereum - 0x517b5fA372793d878C063DCEa2286AA2307D2Ebf

XRP - rsASHgirdZdgSjAuQncg4Nc2PqPFNkjTCz

Dogecoin - DHt2KKtrzsyxvPv1QADLzh1xwxTiiW7iEK

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
