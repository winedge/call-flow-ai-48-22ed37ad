## Plan to fix the slow dashboard after login

The hosted backend is healthy, so the delay is coming from the app’s client-side auth/data loading flow.

### What I’ll change

1. **Stop blocking the dashboard on the heaviest dataset**
   - The app currently loads all contacts during initial dashboard hydration.
   - Contacts are the slowest/repeated backend query and are not needed to render the dashboard.
   - I’ll make dashboard startup load only the data it needs first: agents, campaigns, recent calls, phone numbers, appointments, automations, and settings.

2. **Load contacts only when needed**
   - Move full contacts loading to the Contacts page.
   - Keep contacts paginated/batched so large contact lists don’t delay login or dashboard rendering.

3. **Make auth readiness faster and safer**
   - Replace the initial `getUser()` network call in the sync hook with `getSession()` so the app uses the restored local session immediately after login.
   - Keep auth state-change handling, but avoid doing blocking auth/network work inside auth callbacks.

4. **Improve dashboard rendering performance**
   - Remove repeated full-array filtering in dashboard calculations where possible.
   - Reuse precomputed maps/counts for campaign and agent stats so rendering stays fast as call history grows.

5. **Validate after implementation**
   - Verify the dashboard renders quickly from an authenticated session.
   - Check that Contacts still loads/imports/deletes correctly after contact loading becomes page-specific.

### Expected result

After login, the dashboard should show much faster because it will no longer wait for the entire contacts table before becoming usable.