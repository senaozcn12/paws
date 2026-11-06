# PAWS setup and handoff

This React/Vite app preserves the existing PAWS CSS and components. Added registration, approval status, administrator review, password recovery, and searchable country/subdivision controls. No application or database deployment is performed by these changes.

## Local development

1. Use Node 22.12+ (or Node 24), run `npm ci`, and copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and the project's publishable key. Never put a service-role or secret key in Vite environment variables.
3. Set `VITE_APP_URL=http://localhost:5173`, without a trailing slash. Start with `npm run dev -- --port 5173 --strictPort`.
4. Configure Supabase as below, apply the reviewed migration, bootstrap an administrator, then register and approve a test veterinarian.

## Exact Auth URL configuration

For a **separate local-development Supabase project**, Authentication → URL Configuration:

- Site URL: `http://localhost:5173`
- Allowed Redirect URLs: `http://localhost:5173` and `http://localhost:5173/reset-password`

If opening the app through another hostname or port, use that exact origin consistently in `VITE_APP_URL`, Site URL and the two allowlist entries. `localhost` and `127.0.0.1` are different origins.

For the **deployed project**, the production hostname is not present in this checkout and must be supplied by the operator. Set `VITE_APP_URL` to the real HTTPS origin before building, e.g. if the actual origin is `https://paws.your-clinic.org`, configure exactly:

- Site URL: `https://paws.your-clinic.org`
- Allowed Redirect URLs: `https://paws.your-clinic.org` and `https://paws.your-clinic.org/reset-password`

Replace the example hostname with the actual deployment origin; do not add the example domain. No wildcard redirects are needed. If sharing a Supabase project with local development, keep the deployed Site URL and explicitly add the two localhost redirect entries above. Auth email redirects use `VITE_APP_URL`; the fallback is the browser origin. Changing Vite environment values requires rebuilding. Hosting must serve `index.html` for `/register`, `/forgot-password`, and `/reset-password` (SPA fallback), including direct email-link navigation.

## Email and password configuration

- Enable Email authentication and email confirmations in Supabase Auth.
- For reliable delivery, configure Authentication → SMTP with the provider's host, port, SMTP username/password, verified sender address and PAWS sender name. Configure domain verification/SPF/DKIM as required by that provider. Supabase's default sender is limited and unsuitable for general production delivery; use authorized test recipients when testing it.
- Keep the Reset Password template's link targeting `{{ .ConfirmationURL }}`. Supabase verifies that link before redirecting to `/reset-password`; do not substitute a bare application URL. Keep the Confirm Signup template using `{{ .ConfirmationURL }}` as well.
- Configure token expiration and rate limits intentionally. Test an expired link. Avoid email link-tracking or scanners that consume one-time links.
- Set the Supabase minimum password length to **8** to match the supplied default. If configured differently, set `VITE_PASSWORD_MIN_LENGTH` to the same integer. Set `VITE_PASSWORD_REQUIRED_CHARACTERS` to the matching comma-separated subset of `lower,upper,digit,symbol`, or leave empty when none are required. Supabase remains authoritative and its validation errors are displayed. Enable leaked-password protection if available/desired in the project; rejected passwords remain on the reset form.
- Requesting recovery always returns the same neutral message for known and unknown addresses and delivery/rate-limit failures. A failure can require retrying later. No account-existence details are displayed.
- This browser-only app uses Supabase's default implicit recovery flow. `PASSWORD_RECOVERY` establishes the reset form before profile routing. A tab-scoped user marker allows refreshing that form; it does not grant database privileges. Invalid/expired callbacks never become a reset form merely because an unrelated signed-in session exists. After reset, the local session is signed out and the user is guided to sign in.

References: [Supabase password recovery](https://supabase.com/docs/guides/auth/passwords), [redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Database migration and authorization

Review and apply `supabase/migrations/202611050001_registration.sql` through the project's normal migration process in staging first. It assumes existing `public.animals` and `public.treatments` tables from this app; it creates `profiles` and `registration_reviews`. It is a one-time migration and intentionally fails if conflicting schema already exists. Back up existing schema and policies first.

New and preexisting accounts start pending with the veterinarian role. A signup trigger copies only name/location, never client-supplied role or approval status. Password recovery updates only Auth's password; no profile update trigger exists. Clients cannot write profile role/status directly. Only approved administrators can call `review_registration`; decisions are logged with reviewer and time. Approved administrators and veterinarians access patient records. Administrators also review applications from Account in the patient-records header. Pending and rejected accounts remain restricted regardless of role.

Bootstrap an administrator using the trusted Supabase SQL editor after creating and verifying their Auth account:

```sql
update public.profiles
set role = 'admin', approval_status = 'approved'
where id = 'REPLACE_WITH_VERIFIED_ADMIN_AUTH_USER_UUID';
```

Never provide a browser-facing endpoint for this bootstrap. Review existing accounts individually; do not approve everyone automatically.

The migration adds restrictive approval gates to **all operations** on animals/treatments. These compose with existing policies and prevent permissive existing policies from bypassing approval. Existing permissive policies must still authorize the intended operations. If none exist, add appropriately scoped permissive policies for approved veterinarians through a reviewed migration. This change deliberately does not invent patient ownership rules or broaden existing access.

Audit other exposed tables, views, RPC functions and storage buckets before release. Existing appointments and test results in this checkout use browser localStorage and are not server-authorized data stores; shared-browser data isolation and migrating them are separate work. RLS cannot protect localStorage. No remote database, SMTP setup, admin bootstrap or live email delivery has been performed here.

The earlier registration/admin requirements referenced by the request were not supplied. This implementation assumes name, email, password, country and region, veterinarian self-registration, and admin approval/rejection without collecting additional license documents. Reconcile any additional acceptance criteria before release.

## Location data and accessibility

Uses the complete installed [country-region-data](https://github.com/country-regions/country-region-data) dataset (249 countries/territories), with lockfile-pinned dependency resolution. Country names must match the dataset; available subdivisions must also match. Case-insensitive prefix suggestions support Arrow Up/Down, Enter, Escape and Tab, visible labels, combobox/listbox semantics and active-option announcements. Country edits clear the region. Countries represented by a single same-name subdivision are treated as having no subdivisions; optional manual region entry is available for those and any empty dataset entries. Update the dependency periodically for geopolitical/address changes.

## Verification

- `npm run build`
- `npm run lint` (this checkout has a preexisting `react-hooks/set-state-in-effect` violation in `src/pages/TestResults.jsx`; added auth files are checked separately)
- `npm test` uses installed Google Chrome, mocked Supabase HTTP responses, and an isolated Vite server on port 5187. It does not send real mail or mutate Supabase. Install Chrome or change Playwright's launch channel for your environment.

Before release, run these live checks against staging:

1. Register, confirm email, verify pending status; approve and reject applicants as an admin. Confirm a nonadmin cannot read other profiles, change their own role/status, call review RPC, or read/write patient tables while pending/rejected (test the API directly, beyond UI navigation). Check `registration_reviews` records the trusted reviewer.
2. Request reset for known and unknown emails: identical neutral message. Verify actual delivery, SMTP logs, correct HTTPS redirect and direct navigation on deployed hosting.
3. Open a valid recovery link for pending, rejected, approved veterinarian and admin accounts: always reset screen. Confirm mismatch/short/required-character failures. Refresh the form, update password, sign in with the new password, and verify role/status unchanged. Pending/rejected users remain restricted in both UI and API. Old password fails.
4. Test expired, malformed and reused links, logged-in unrelated sessions, network failure, Supabase password rejection and retry. Each invalid link offers another request.
5. Select United States, type `I` or `i`, confirm Illinois/Indiana/Iowa suggestions; select with keyboard. Change to Canada and verify the old state clears; select Ontario. Test a country without subdivisions (Antarctica), optional manual region, invalid typed country, mobile layout and screen-reader interaction.

## Admin patient access update (existing installations)

Apply `supabase/migrations/202611060001_admin_patient_access.sql` once after the initial registration migration. It replaces the approval-check function so approved administrators have the same record permissions as approved veterinarians; it does not change any user's role or status. Existing `animals`/`treatments` approval gates automatically use the updated function. Preserve existing grants and policies; any separate policy specifically limited to veterinarians must also be reviewed if it prevents admin access.

After updating the app, approved admins land on Patient Records. Click Account in the header for registration review, then Patient Records to return without losing the current patient. Approved veterinarians can view their account information there and cannot review applications. Pending/rejected users remain on the restricted status screen. Recovery links continue taking priority over these views.

For a new setup, apply both migrations in filename order. Do not rerun the original registration migration on an existing setup. No remote migration or deployment has been run automatically.

## Animal creation and Global IDs

Apply `supabase/migrations/202611060002_create_animals.sql` **after both earlier migrations**, before deploying this version. For an existing installation, run only this new migration. It assumes the existing `animals` columns shown in the sample CSV (`chip_id`, `name`, `animal`, `species`, `age`, `sex`, `notes`) and adds a new `global_id` UUID column. If the live schema differs or already has a Global ID column, reconcile it before running. The migration has been verified against an isolated PostgreSQL runtime; live Supabase is unchanged.

The database generates a Global ID for every existing and new animal. Existing chip IDs, treatment links and records remain intact. Global IDs cannot be changed by normal UPDATE operations. Approved veterinarians and admins can click **Create animal** on Patient Records. Required fields: Chip ID (max 128), name, animal type and breed/species (max 100 each). Optional: nonnegative whole-number age, sex (F/M/U), and notes (max 5000). Zero years displays correctly. After saving, the patient summary shows the generated Global ID; search accepts either Chip ID or Global ID. The Global ID is a randomly generated UUID with database uniqueness enforcement, not a globally coordinated registry number outside PAWS.

Uniqueness is enforced by a database unique constraint for Global IDs and a unique index on lower(trim(Chip ID)); concurrent requests cannot create duplicates. The form does not upsert or overwrite an existing animal. A duplicate error keeps entries and directs the user to search or correct the chip. On a network failure with uncertain save status, search the chip before retrying. The `create_animal` RPC uses SECURITY INVOKER, so existing RLS remains in effect; it does not accept client role/status values. Its explicit insert policy requires approved access, and the earlier restrictive approval gate still applies. Existing SELECT policies/grants must permit approved users to read animals for the RPC RETURNING result and search. Keep RLS enabled.

The migration deliberately stops if imported Chip IDs already collide ignoring capitalization or outer spaces. Inspect collisions before applying:

```sql
select lower(btrim(chip_id)) as normalized_chip_id,
       array_agg(chip_id) as existing_chip_ids,
       count(*) as records
from public.animals
where chip_id is not null
group by lower(btrim(chip_id))
having count(*) > 1;
```

Resolve collisions carefully with related treatments; never delete or merge clinical records blindly. The migration leaves legacy incomplete field values untouched, but future inserts/updates must satisfy the new validation trigger. If the live table has other NOT NULL columns without defaults or custom constraints, provide appropriate defaults/extend the reviewed RPC before use. Existing serial ID defaults may also require sequence USAGE for authenticated, depending on your existing grants.

Verification:

- `npm run test:db`: isolated PostgreSQL tests for migration/backfill, immutable unique IDs, case/space duplicate chips, required fields, optional values, age validation, and approved/admin/pending/rejected/anonymous access. No Supabase connection or credentials needed.
- `npm test`: browser tests also cover both approved roles creating animals, Global ID search, validation/duplicate messages and preserving entries.
- Before release, repeat creation/search using the real staging schema and verify direct API duplicate submissions are denied. Confirm old patients still search by their original chips and treatments still load.

After applying the migration, commit/push the new code and deploy via the existing Vercel workflow. This change does not deploy or run remote SQL automatically.

## Pharmacy assignment, fulfillment, and tracking

Apply **`supabase/migrations/202611060005_pharmacy_fulfillment.sql`** after medication-order migration `202611060003_medication_orders.sql` and cancellation migration `202611060004_cancel_medication_orders.sql`. The earlier animal/registration/admin migrations must already be installed. On an existing installation, run only missing migrations in filename order; never rerun all old migrations. Review/back up your live schema and try staging first. This migration and the tests assume the exact medication schema from migrations 003/004. It has not been applied to remote Supabase automatically.

The migration preserves existing prescriptions, their clinical fields, and prescribers. Existing pending prescriptions start **Needs pharmacy assignment**; existing cancelled prescriptions remain cancelled. The original prescriber can route an existing unassigned order through its history entry. New prescriptions require an approved pharmacy and clinic delivery details.

### First-time setup through the app

1. Apply the new SQL migration and deploy the updated app, or run it locally.
2. Have pharmacy staff register with **Account type → Pharmacy staff** and confirm their email. Signup can request only a pending pharmacy or veterinarian role; it cannot grant approval, admin privileges, or pharmacy membership. Password recovery preserves role, membership, and approval.
3. As an approved administrator, open **Account → Pharmacy administration**. Enter the pharmacy's name and click **Add approved pharmacy**.
4. Select the registered staff email and the approved pharmacy, then click **Approve and assign pharmacy staff**. This assigns an approved pharmacy role and logs the approval. Staff who already registered as veterinarians can also be explicitly converted by the admin here; they then lose veterinarian access. Administrator accounts cannot be converted through this action.
5. Repeat for additional employees at the same pharmacy. One staff account belongs to one pharmacy at a time. Staff should refresh their status page or sign in again after approval.
6. An admin can suspend an organization with **Suspend [pharmacy]**, which removes all its staff's access immediately at the database layer. The administrator can also reject an individual staff account using registration review. Existing assignments remain recorded; suspended pharmacies are unavailable for new assignments.

### Vet and pharmacy workflow

- Approved veterinarians create prescriptions from the animal's **Medications** section. Select an approved pharmacy and enter the clinic name, recipient, full postal address and delivery instructions (5–2000 characters). Pharmacy availability is chosen manually; PAWS does not maintain inventory or choose suppliers automatically.
- Orders start **Awaiting pharmacy acceptance**. Only the original approved veterinarian may edit assignment or delivery details while unassigned, awaiting acceptance, or declined/released. An approved admin can read prescription history; prescribing/reassignment remain veterinarian-only, matching the medication feature's existing authorization.
- Approved pharmacy staff land on **Pharmacy fulfillment**. They can see prescriptions assigned to their organization, including dosage, frequency, reason, prescriber ID, animal Global ID, and clinic delivery address. They do not receive access to unrelated animal records or other pharmacies' prescriptions.
- Choose **Accept and process** or **Decline order** under Fulfillment action. Decline requires a reason. Accepted orders become **Processing**.
- A processing pharmacy can **Ship order** or **Release to veterinarian** (reason required). A release returns the order to declined/released so the prescriber can reassign or cancel it. Reassignment/cancellation is blocked while processing or shipped to prevent multiple pharmacies filling the same prescription. Release is unavailable after shipping.
- Shipping requires carrier and tracking number; an optional tracking link must use HTTPS. While shipped, the pharmacy may correct tracking data or **Mark delivered**. Delivery changes order status to **fulfilled** and is final in this workflow. Medication, dosage, frequency, reason, animal, and prescriber cannot be edited by pharmacy staff.
- The original prescriber can cancel before acceptance, after decline/release, or while unassigned. Cancellation is final. The existing confirmation step remains.
- Vets can see current pharmacy, fulfillment status, notes, carrier, number and tracking link in medication history. Use **Refresh medication orders** to see changes made by other sessions. Pharmacy staff use **Refresh orders**. This workflow uses manual updates, not realtime notifications or courier integrations; it does not purchase labels, send orders to a third-party pharmacy API, or send new notification emails. Existing signup/recovery SMTP configuration is unchanged.

### Database protections and audit

Pharmacy organizations and profile memberships can be changed only through admin-checked RPC functions. RLS permits pharmacy staff to read only orders currently assigned to their approved organization. No client UPDATE/DELETE grants exist on medication orders. Fulfillment/assignment/cancellation RPCs authorize the caller, lock the order row, and enforce the allowed transitions. Assignment and fulfillment updates check a monotonically increasing version to reject stale requests. The UI retains entries on failures and instructs the user to refresh when another session has changed the order.

New-order triggers verify the original approved veterinarian, validate the approved pharmacy and delivery details, set initial server-controlled fulfillment fields, and prevent forged shipped/fulfilled states. An append-only `medication_fulfillment_events` table records the actor, order, status, pharmacy, delivery details, tracking fields and version on each insert/update. Its RLS follows order visibility; a former pharmacy loses access to both the reassigned order and its audit rows. Approved vets/admins retain the visibility they already had under medication-order RLS. Service-role/SQL-owner access remains trusted.

### Verification before release

`npm test` includes vet assignment and reassignment, pharmacy acceptance/shipping/delivery, invalid links, stale-version handling, admin setup, pending/rejected restrictions, pharmacy signup and recovery, plus earlier animal/auth/appointment checks. Browser tests mock Supabase; no live prescriptions or emails are created. `npm run test:db` uses isolated PostgreSQL to exercise the full migration chain, shared staff access, cross-pharmacy read/write denial, protected prescription fields, role/approval enforcement, release/reassignment/cancellation, spoofed signup/order metadata, tracking validation, final delivery, audit ownership and stale requests.

Repeat in staging with **two pharmacy organizations, two employees at one organization, a veterinarian, and an administrator**. Verify each organization sees only its own orders, same-organization employees can share work, rejected/suspended members lose access, and an accepted order cannot be reassigned or cancelled until released. Try accepting and reassigning from two browser sessions and confirm one succeeds while the stale operation is rejected. Confirm old prescriptions and clinical values remain intact. Test real signup/recovery delivery using your existing SMTP setup.

## Diagnostic-center accounts and approval

Apply **`supabase/migrations/202611060006_diagnostic_center_accounts.sql`** after the pharmacy migration (005). On existing installations, run only this new migration. Review the schema and use staging first; it depends on the existing profiles/pharmacies/review tables and named role constraint created by the earlier migrations. Existing records and roles are preserved. No remote SQL, deployment, commit, or push is performed automatically.

Setup and use:

1. Run the new migration, then run the updated app locally or deploy it through the existing GitHub/Vercel workflow.
2. A staff member registers with **Account type → Diagnostic-center staff** and confirms their email. The database creates a **pending** `diagnostic_staff` profile with no organization. Client-supplied role/approval/membership metadata cannot grant privileges.
3. An approved administrator opens **Account → Diagnostic center administration**, enters an organization name, and clicks **Add approved diagnostic center**.
4. After verifying the person's affiliation, select the registered email and approved center, then click **Approve and assign diagnostic staff**. This links the account, approves access, and records the trusted reviewer in `registration_reviews`. Existing registered non-admin accounts may also be explicitly converted here; their previous veterinarian/pharmacy privileges are replaced. Admin accounts cannot be converted by this action.
5. Staff refresh their pending-status page or sign in again. Approved diagnostic staff land on **Diagnostic center → Center access**, displaying only their own approved organization and account information. Multiple employees can share a center; each account has one center membership.
6. Admins can suspend/reapprove a center using the organization button, or reject an individual staff account through registration review. Approval through the ordinary review button requires an existing approved center assignment. A suspended center immediately fails the database membership check for every employee; a staff member can use **Refresh center access** to see the restriction. Reactivating a center does not approve an individually rejected account.

Authorization:

- Only approved admins can create/update centers or associate accounts. Centers use RLS; diagnostic staff can read only their own active center, approved vets/admins can read approved centers for future selection, and admins can also read suspended centers.
- `paws_diagnostic_center_id()` is the authoritative effective-membership helper for future diagnostic-order/result policies. It returns null unless role, staff approval, membership, and center approval all match.
- Diagnostic staff receive **no** animal-record, prescribing, pharmacy-queue, or organization-administration privileges. All center mutations and role changes go through admin-checked database functions.
- Moving an account from pharmacy to diagnostic staff clears its old pharmacy membership; moving it back clears diagnostic-center membership. Existing pharmacy behavior remains protected.
- Password recovery takes precedence over role routing and does not change approval or center membership.

This step intentionally implements **accounts, organization approval and staff access only**. Test-order creation, center order queues, result submission and shared result-file storage are not implemented yet. The staff landing page states that these features are unavailable rather than displaying a simulated queue.

Verification: `npm run build`, focused ESLint on changed files, `npm test` (41 browser tests using mocked Supabase), and `npm run test:db` (6 isolated PostgreSQL tests). Test the new signup/approval flow with real accounts in staging, use two centers to confirm isolation, test center suspension and individual rejection, then confirm pharmacy and veterinarian logins still work. The existing full-project TestResults.jsx lint issue remains unrelated to this change.
