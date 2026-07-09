## What’s broken

Both **Create list** and **Import CSV** are failing for the same backend reason:

- `contact_lists` and `contacts` have row-level rules that correctly restrict data to the signed-in user.
- But they are missing the required backend table grants for the app role.
- Result: the UI writes to the local cache, but the database rejects the save, so after refresh or when creating a campaign there are no real lists/contacts to select.

## Plan

### 1. Fix backend access for lists and contacts

Add a database migration that grants the app permission to use the existing private tables:

- `contact_lists`
  - Signed-in users can create, view, edit, and delete only their own lists.
  - Backend service role keeps full access for trusted server tasks.
- `contacts`
  - Signed-in users can create, view, edit, and delete only their own contacts.
  - Backend service role keeps full access for trusted campaign/telephony tasks.

No public/anonymous access will be added because contacts contain phone numbers and emails.

### 2. Make list creation show real success/failure

Update `src/lib/data-store.ts` and `src/routes/_app.contacts.tsx` so **New list** waits for the database save before showing success.

- If the save works, add the list to the UI.
- If the save fails, show the real error instead of pretending it worked.

### 3. Make CSV import list-based

Update the Contacts page import flow so every CSV goes into one contact list:

- User chooses an existing list, or creates a new list during import.
- If no list exists yet, the import defaults to creating a new list from the CSV filename.
- Imported contacts are saved with that `list_id`.
- Campaign creation can then select that same list.

### 4. Make CSV import reliable for larger files

Replace the current fire-and-forget import with an awaited batch import:

- Parse and validate phone numbers before insert.
- De-dupe against existing contacts in the database, not only local cache.
- Insert contacts in batches so large CSV files do not fail as one giant request.
- Show accurate results: imported, duplicate, invalid, and failed rows.

### 5. Add a campaign list count check

On the **Create campaign** page, show how many contacts are in the selected list so you can confirm the campaign has numbers before starting it.

## Technical details

- Migration needed:
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_lists TO authenticated;`
  - `GRANT ALL ON public.contact_lists TO service_role;`
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;`
  - `GRANT ALL ON public.contacts TO service_role;`
- Existing RLS policies already scope rows with `auth.uid() = user_id`, so the data remains private.
- No anonymous grants will be added.
