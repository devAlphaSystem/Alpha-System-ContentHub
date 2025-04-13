1.  **Configure PocketBase Collections:**

    You need to set up specific collections and fields in your PocketBase Admin UI (usually at `http://YOUR_POCKETBASE_URL/_/`).

    - **`users` Collection (Default):**

      - Go to `users` collection > Options > Identity/Password.
      - Ensure **"Identity/Password"** is **ENABLED**.
      - You might want to disable **"Send email alert for new logins"** to avoid error logs.
      - Create at least one **non-admin user** account via the UI. This user account will be used to log into the Content Hub application itself.

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
