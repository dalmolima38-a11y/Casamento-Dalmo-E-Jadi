# Security Specification — Nosso Para Sempre | Dalmo & Jadi

## 1. Data Invariants
1. **Strict PII Isolation**: Public visitors can NEVER `get` or `list` `/rsvps`, `/gift_orders`, `/rsvp_revisions`, or `/admin_logs`.
2. **Moderation Gate**: Public visitors can ONLY `get` or `list` `/guestbook_messages` and `/gallery_photos` where `resource.data.status == 'approved'`. New public submissions MUST start with `status == 'pending'`.
3. **Zero Click-to-Pay Fraud**: Public guests creating a `/gift_orders` document MUST set `status` to `'reserved'` or `'awaiting_confirmation'`, NEVER `'confirmed'`. Only an authenticated admin (`isAdmin()`) or verified server webhook can transition an order to `'confirmed'`.
4. **RSVP Edit Token Integrity**: A guest can only submit an `/rsvp_revisions` document if `exists(/databases/$(database)/documents/rsvps/$(incoming().rsvpId))` AND `get(...).data.editTokenHash == incoming().tokenHash`. One guest cannot discover or alter another guest's RSVP.
5. **Participant Bounds**: RSVPs are strictly bounded to `attendeesCount >= 1 && attendeesCount <= 10` and `attendeeNames.size() <= 10`, entering with `status == 'pending_review'` for administrative validation.
6. **Privilege Escalation Prevention**: Only verified admins (`dalmofilho38@gmail.com`, `dalmolima38@gmail.com` with `email_verified == true`, or listed in `/admins/{uid}`) can write `/admins`, `/site_settings`, `/timeline_events`, `/faqs`, `/gallery_albums`, or `/admin_logs`.
7. **Referential Integrity**: `/gallery_photos` requires `exists(/databases/$(database)/documents/gallery_albums/$(incoming().albumId))` on create.
8. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps on write must equal `request.time`.
9. **Financial & Receipt Preservation**: Confirmed `/gift_orders` (`status == 'confirmed'`, `confirmedAtIso` present, or `paymentMethod == 'pix_webhook'`) cannot be permanently deleted, even by an admin; administrative removal archives/hides them (`adminArchived: true`) while preserving accounting records. Only unconfirmed/cancelled/test orders may be permanently deleted by verified admins.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated RSVP Scrape**: `list /rsvps` as unauthenticated visitor -> `PERMISSION_DENIED`.
2. **Unauthenticated Payment/Receipt Scrape**: `get /gift_orders/order1` as unauthenticated visitor -> `PERMISSION_DENIED`.
3. **Click-to-Pay Status Forgery**: `create /gift_orders/order2` with `{ status: 'confirmed' }` -> `PERMISSION_DENIED`.
4. **Cross-Guest RSVP Hijack**: `create /rsvp_revisions/rev1` with mismatched `tokenHash` -> `PERMISSION_DENIED`.
5. **Unlimited RSVP Participant Injection**: `create /rsvps/r1` with `attendeesCount: 500` -> `PERMISSION_DENIED`.
6. **Unmoderated Guestbook Bypass**: `create /guestbook_messages/m1` with `status: 'approved'` -> `PERMISSION_DENIED`.
7. **Unverified Email Admin Spoof**: Sign in with `email: 'dalmofilho38@gmail.com'`, `email_verified: false` -> `PERMISSION_DENIED` on `/site_settings/main`.
8. **Shadow Field Injection on RSVP**: `create /rsvps/r2` including `{ isAdmin: true }` -> `PERMISSION_DENIED`.
9. **Path ID Poisoning**: `create /rsvps/invalid$id!` -> `PERMISSION_DENIED`.
10. **Gift Quota Overflow**: `update /gifts/g1` setting `reservedQuotas: 999` when `totalQuotas: 5` -> `PERMISSION_DENIED`.
11. **Orphan Gallery Photo**: `create /gallery_photos/p1` referencing nonexistent `albumId: 'fake_album'` -> `PERMISSION_DENIED`.
12. **Timestamp Backdating**: `create /guestbook_messages/m2` with client-supplied past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
