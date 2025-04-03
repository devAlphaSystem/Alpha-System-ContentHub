# Content Hub 📝✨

A simple NodeJS application for creating and managing changelogs and documentation using Markdown, powered by PocketBase.

## Features

- **📝 Markdown Editing:** Create and manage content using a familiar Markdown editor (EasyMDE) with toolbar assistance and Ctrl+S saving.
- **🖥️ Admin Dashboard:** A central place to view, create, edit, and delete your documentation and changelog entries with a clean sidebar layout.
- **🔒 Secure Access:** Dashboard access is protected by PocketBase user authentication.
- **🌗 Light & Dark Themes:** Choose your preferred viewing mode for the admin interface.
- **👁️ View Tracking:** Basic view counts are recorded for each public entry page using SQLite and privacy-preserving IP hashing.
- **🚀 Pocketbase Backend:** Leveraging the speed and simplicity of Pocketbase for data storage.
- **📄 Public View Pages:** Automatically generated, styled pages for customers to view published entries.
- **⚙️ Configurable:** Uses environment variables for easy setup.
- **⬆️ Version Check:** Checks against a specified GitHub repository for available updates (optional).

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
    # PocketBase instance
    POCKETBASE_URL=http://127.0.0.1:8090
    POCKETBASE_ADMIN_EMAIL=your_admin_email@example.com
    POCKETBASE_ADMIN_PASSWORD=your_admin_password

    # "development" mode or "production"
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
      - Create at least one admin user via the UI so you can log into Content Hub.

    - **`entries` Collection (Create New):**
      - **Name:** `entries`
      - **Fields:**
        - `title` (Type: `Text`, Required: Yes, Max Length: e.g., 200)
        - `type` (Type: `Select`, Required: Yes, Values: `changelog, documentation`, Max Select: 1)
        - `domain` (Type: `Text`, Required: Yes, Max Length: e.g., 100)
        - `content` (Type: `Editor` or `Text`, Required: Yes, Max Length: e.g., 500000 or more - **Important:** Adjust based on your needs!)
        - `views` (Type: `Number`, Required: No, Default Value: `0`, Min: `0`)
        - `owner` (Type: `Relation`, Collection: `users`, Max Select: 1)
        - `status` (Type: `Select`, Required: Yes, Values: `draft, published`, Max Select: 1)
        - `tags` (Type: `Text`, Required: No, Max Length: e.g., 250)
      - **API Rules:**
        - List: `owner.id = @request.auth.id`
        - View: `status = "published" || owner.id = @request.auth.id` _(Publicly viewable)_
        - Create: `owner.id = @request.auth.id`
        - Update: `owner.id = @request.auth.id`
        - Delete: `owner.id = @request.auth.id`

## Running the Application

1.  **Development Mode (with automatic restarts):**

    - Requires `nodemon` installed (`npm install -g nodemon` or add to `devDependencies`).
    - Run:
      ```bash
      npm run dev
      ```

2.  **Production Mode:**

    - Run:
      ```bash
      npm start
      ```

3.  **Access:**
    Open your browser and navigate to `http://localhost:3000` (or the port specified in your `.env` file).

## Usage

1.  Navigate to the application URL.
2.  You will be redirected to the `/login` page.
3.  Log in using the credentials for a user created in your PocketBase `users` collection.
4.  You will be redirected to the dashboard (`/`).
5.  From the dashboard, you can:
    - View existing entries.
    - See view counts.
    - Click "Create New" to add a new entry using the Markdown editor.
    - Click the "View" icon to see the public page for an entry.
    - Click the "Edit" icon to modify an existing entry.
    - Click the "Delete" icon to remove an entry (with confirmation).
6.  Use the theme toggle in the sidebar to switch between light and dark modes.
7.  Use `Ctrl+S` (or `Cmd+S`) on the Create/Edit pages to save the form.

## Notes

- **Session Storage:** This application uses `connect-sqlite3` to store sessions in a `sessions.db` file within the `db/` directory. This is suitable for development and moderate production loads but consider alternatives like Redis or PostgreSQL for high-traffic sites.
- **View Tracking:** View counts are incremented based on unique hashed IP addresses within a 24-hour window. This uses a separate `view_tracking.db` file. Hashing IPs enhances privacy but is not a complete substitute for a full GDPR/LGPD compliance review.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
