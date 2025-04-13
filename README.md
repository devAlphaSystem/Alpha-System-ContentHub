# Content Hub 📝✨

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
  # --- Core Settings ---
  # PocketBase instance URL
  POCKETBASE_URL=http://127.0.0.1:8090
  # Credentials for an ADMIN user in PocketBase (used for background tasks)
  POCKETBASE_ADMIN_EMAIL=your_admin_email@example.com
  POCKETBASE_ADMIN_PASSWORD=your_admin_password

  # Set to "production" for production environments, otherwise "development"
  NODE_ENV=development

  # Port for the NodeJS application to run on
  PORT=3000

  # --- Security ---
  # Generate strong, random strings for these secrets!
  # Use a password manager or online generator.
  SESSION_SECRET=your-very-strong-random-secret-key-here
  IP_HASH_SALT=another-very-strong-random-secret-for-hashing-ips
```

2.  **Configure PocketBase Collections:**

    You need to set up specific collections and fields in your PocketBase Admin UI (usually at `http://YOUR_POCKETBASE_URL/_/`).

    - **`users` Collection (Default):**

      - Go to Settings > Auth Providers > Email/Password.
      - Ensure **"Allow email/password authentication?"** is **ENABLED**.
      - Create at least one user via the UI so you can log into Content Hub.

    - **`entries_main` Collection:**

      - **Name:** `entries_main`
      - **Fields:**
        - `title` (Type: `Text`, Required, Nonempty, Max Length: e.g., 200)
        - `type` (Type: `Select`, Required, Values: `changelog, documentation`, Max Select: `1`)
        - `content` (Type: `Rich editor`, Required, Nonempty)
        - `status` (Type: `Select`, Required, Values: `draft, published`, Max Select: `1`)
        - `tags` (Type: `Text`, Max Length: e.g., 250)
        - `collection` (Type: `Text`, Max Length: e.g., 100)
        - `views` (Type: `Number`, Default Value: `0`, Min: `0`)
        - `owner` (Type: `Relation`, Required, Collection: `users`, Max Select: `1`, Cascade Delete: `False`)
        - `files` (Type: `File`, Max Select: `Multiple`)
        - `has_staged_changes` (Type: `Bool`, Default Value: `false`)
        - `staged_title` (Type: `Text`, Max Length: e.g., 200)
        - `staged_type` (Type: `Select`, Values: `changelog, documentation`, Max Select: `1`)
        - `staged_content` (Type: `Rich editor`)
        - `staged_tags` (Type: `Text`, Max Length: e.g., 250)
        - `custom_header` (Type: `Relation`, Collection: `headers`, Max Select: `1`, Cascade Delete: `False`)
        - `custom_footer` (Type: `Relation`, Collection: `footers`, Max Select: `1`, Cascade Delete: `False`)
        - `staged_custom_header` (Type: `Relation`, Collection: `headers`, Max Select: `1`, Cascade Delete: `False`)
        - `staged_custom_footer` (Type: `Relation`, Collection: `footers`, Max Select: `1`, Cascade Delete: `False`)
      - **API Rules:** (Adjust as needed, especially Update rule for header/footer ownership)
        - List: `owner.id = @request.auth.id`
        - View: `status = "published" || owner.id = @request.auth.id`
        - Create: `owner.id = @request.auth.id`
        - Update: `owner.id = @request.auth.id`
        - Delete: `owner.id = @request.auth.id`

    - **`entries_archived` Collection:**

      - **Name:** `entries_archived`
      - **Fields:** (Mirror `entries_main` non-staged fields, plus `original_id`)
        - `title` (Type: `Text`)
        - `type` (Type: `Select`, Values: `changelog, documentation`)
        - `content` (Type: `Rich editor`)
        - `status` (Type: `Select`, Values: `draft, published`)
        - `tags` (Type: `Text`)
        - `collection` (Type: `Text`)
        - `views` (Type: `Number`)
        - `owner` (Type: `Relation`, Collection: `users`)
        - `original_id` (Type: `Text`)
        - `custom_header` (Type: `Relation`, Collection: `headers`, Max Select: `1`)
        - `custom_footer` (Type: `Relation`, Collection: `footers`, Max Select: `1`)
        - `files` (Type: `File`, Max Select: `Multiple`) _(Note: Files might not be fully handled on archive/unarchive)_
      - **API Rules:** (Typically Admin/System only, but can mirror `entries_main` if needed)
        - List: `owner.id = @request.auth.id`
        - View: `status = "published" || owner.id = @request.auth.id`
        - Create: `owner.id = @request.auth.id`
        - Update: `owner.id = @request.auth.id`
        - Delete: `owner.id = @request.auth.id`

    - **`entries_previews` Collection:**

      - **Name:** `entries_previews`
      - **Fields:**
        - `entry` (Type: `Relation`, Required, Collection: `entries_main`, Max Select: `1`, Cascade Delete: `False`)
        - `token` (Type: `Text`, Required, Nonempty, Unique)
        - `expires_at` (Type: `DateTime`, Required)
        - `password_hash` (Type: `Text`)
      - **API Rules:** (Restrict to Admin/System)
        - List: `@request.auth.id != ""` (Or restrict to admin role)
        - View: `` _(Publicly viewable)_
        - Create: `@request.auth.id != ""` (Or restrict to admin role)
        - Update: `@request.auth.id != ""` (Or restrict to admin role)
        - Delete: `@request.auth.id != ""` (Or restrict to admin role)

    - **`templates` Collection:**

      - **Name:** `templates`
      - **Fields:**
        - `name` (Type: `Text`, Required, Nonempty)
        - `content` (Type: `Rich editor`, Required)
        - `owner` (Type: `Relation`, Required, Collection: `users`, Max Select: `1`, Cascade Delete: `False`)
      - **API Rules:**
        - List: `owner.id = @request.auth.id`
        - View: `owner.id = @request.auth.id`
        - Create: `owner.id = @request.auth.id`
        - Update: `owner.id = @request.auth.id`
        - Delete: `owner.id = @request.auth.id`

    - **`headers` Collection (Create New):** **(New)**

      - **Name:** `headers`
      - **Fields:**
        - `name` (Type: `Text`, Required, Nonempty)
        - `content` (Type: `Rich editor`, Required) _(Ensure HTML is allowed in Editor settings)_
        - `owner` (Type: `Relation`, Required, Collection: `users`, Max Select: `1`, Cascade Delete: `False`)
      - **API Rules:**
        - List: `owner.id = @request.auth.id`
        - View: `owner.id = @request.auth.id`
        - Create: `owner.id = @request.auth.id`
        - Update: `owner.id = @request.auth.id`
        - Delete: `owner.id = @request.auth.id`

    - **`footers` Collection:**

      - **Name:** `footers`
      - **Fields:**
        - `name` (Type: `Text`, Required, Nonempty)
        - `content` (Type: `Rich editor`, Required) _(Ensure HTML is allowed in Editor settings)_
        - `owner` (Type: `Relation`, Required, Collection: `users`, Max Select: `1`, Cascade Delete: `False`)
      - **API Rules:**
        - List: `owner.id = @request.auth.id`
        - View: `owner.id = @request.auth.id`
        - Create: `owner.id = @request.auth.id`
        - Update: `owner.id = @request.auth.id`
        - Delete: `owner.id = @request.auth.id`

    - **`audit_logs` Collection:**

      - **Name:** `audit_logs`
      - **Fields:**
        - `user` (Type: `Relation`, Collection: `users`, Max Select: `1`, Cascade Delete: `False`)
        - `action` (Type: `Text`, Required)
        - `target_collection` (Type: `Text`)
        - `target_record` (Type: `Text`)
        - `details` (Type: `Json`)
        - `ip_address` (Type: `Text`)
      - **API Rules:** (Restrict to Admin/System)
        - List: `@request.auth.id != ""` (Or restrict to admin role)
        - View: `@request.auth.id != ""` (Or restrict to admin role)
        - Create: `@request.auth.id != ""` (Or restrict to admin role)
        - Update: `@request.auth.id != ""` (Or restrict to admin role)
        - Delete: `@request.auth.id != ""` (Or restrict to admin role)

## Running the Application

1.  **Ensure PocketBase is running.**
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
    Open your browser and navigate to `http://localhost:3000` (or the port specified in your `.env` file).

## Usage

1.  Navigate to the application URL and log in using your PocketBase user credentials.
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
