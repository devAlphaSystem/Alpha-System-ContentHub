![](https://db.alphasystem.dev/api/files/pbc_3165375535/contenthubmarkd/contenthub_logo_bmf7hxuvle.png)

A simple NodeJS application for creating and managing changelogs and documentation using Markdown, powered by PocketBase.

## Features

- **📝 Markdown Editing:** Create and manage content using a familiar Markdown editor (EasyMDE) with toolbar assistance and Ctrl+S saving.
- **🖥️ Admin Dashboard:** A central place to view, create, edit, archive, and manage your documentation and changelog entries with a clean sidebar layout.
- **🎨 Custom Headers & Footers:** Create reusable HTML headers/footers and apply them to specific entries for customized public view pages.
- **📄 Templates:** Define reusable Markdown templates for consistent entry structure.
- **🔒 Secure Access:** Dashboard access is protected by PocketBase user authentication.
- **🌗 Light & Dark Themes:** Choose your preferred viewing mode for the admin interface.
- **👁️ View Tracking:** Basic view counts are recorded for each public entry page using SQLite and privacy-preserving IP hashing.
- **🚀 Pocketbase Backend:** Leveraging the speed and simplicity of Pocketbase for data storage.
- **📄 Public View Pages:** Automatically generated, styled pages for customers to view published entries, with optional custom headers/footers.
- **⚙️ Configurable:** Uses environment variables for easy setup.
- **🔍 Audit Log:** Tracks key actions performed within the application.
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
    ```

2.  **Configure PocketBase Collections (Automated Setup):**

    This project includes a script to automatically set up the required PocketBase collections using an exported schema definition.

    **Prerequisites for Automated Setup:**

    - Your PocketBase instance must be running at the `POCKETBASE_URL` specified in your `.env` file.
    - The `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` in your `.env` file must correspond to a valid **Admin/Superuser** account in your PocketBase instance.
    - The `pb_schema.json` file (containing the collection definitions exported from a working instance) must be present in the project root directory.
    - Node.js dependencies must be installed (`npm install`).

    **Running the Setup Script:**

    - Open your terminal in the project root directory (`Alpha-System-ContentHub`).
    - Run the command:
      ```bash
        node build_pb.js
      ```
    - The script will connect to your PocketBase instance, authenticate as the admin user, and attempt to import the collections defined in `pb_schema.json`. It will skip collections that already exist.
    - Review the script's output for any errors. If errors related to existing collections occur during development, you might need to manually delete the partially created collections from the PocketBase Admin UI (`http://YOUR_POCKETBASE_URL/_/`) and re-run the script.

    > If the automated script doesn't work, you'll have to setup collections [manually](MANUAL_CONFIG.md).

3.  **Configure `users` Collection (Manual Step):**

    You still need to configure the default `users` collection for application login:

    - Navigate to your PocketBase Admin UI (e.g., `http://127.0.0.1:8090/_/`).
    - Go to `users` collection > Options > Identity/Password.
    - Ensure **"Identity/Password"** is **ENABLED**.
    - You might want to disable **"Send email alert for new logins"** to avoid error logs.
    - Create at least one **non-admin user** account via the UI. This user account will be used to log into the Content Hub application itself.

## Running the Application

1.  **Ensure PocketBase is running** and the collections have been configured (using `node build_pb.js` or migrations).
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

1.  Navigate to the application URL and log in using your PocketBase **user** credentials (not the admin ones).
2.  **Dashboard (`/`):** View, filter, and sort active entries. Perform actions like Archive, Delete, or Publish Staged Changes. Initiate bulk actions.
3.  **Create New (`/new`):** Create a new documentation or changelog entry. Use the Markdown editor, apply optional templates, and select optional custom headers/footers.
4.  **Edit Entry (`/edit/:id`):** Modify an existing entry. If the entry is published, changes are staged by default. Select optional custom headers/footers. Generate preview links for drafts.
5.  **Archived (`/archived`):** View archived entries. Unarchive or permanently delete them.
6.  **Templates (`/templates`):** Create, view, edit, and delete reusable Markdown templates.
7.  **Headers (`/headers`):** Create, view, edit, and delete reusable HTML headers.
8.  **Footers (`/footers`):** Create, view, edit, and delete reusable HTML footers.
9.  **Audit Log (`/audit-log`):** View a log of system and user actions. Export or clear logs.
10. **Public View (`/view/:id`):** Access the public page for a published entry. This page will use the selected custom header/footer if one is assigned, otherwise it uses the default structure.
11. **Preview (`/preview/:token`):** Access a draft entry using a generated preview link (may require a password). This page will use the selected custom header/footer (preferring staged versions if available).
12. **Theme Toggle:** Use the toggle in the sidebar to switch between light and dark modes for the admin interface.
13. **Save Shortcut:** Use `Ctrl+S` (or `Cmd+S`) on Create/Edit pages (Entries, Templates, Headers, Footers) to save the form.

## Notes

- **Session Storage:** Uses `connect-sqlite3` storing sessions in `db/sessions.db`. Consider alternatives (Redis, PostgreSQL) for high-traffic production.
- **View Tracking:** Uses `sqlite3` storing view logs in `db/view_tracking.db`. Hashing IPs enhances privacy but review GDPR/LGPD compliance if applicable.
- **PocketBase Editor Fields:** Ensure the `content` fields in `headers` and `footers` collections are set to the `Editor` type in PocketBase and configured to allow HTML input if you want rich text editing capabilities there. If using plain `Text`, the application will still render it as HTML on the view page.
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
