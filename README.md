# My First repository

## Booking email notifications

This project sends automatic booking emails with the Firebase Trigger Email extension.

Setup steps:
1. Install the "Trigger Email" extension in your Firebase project.
2. Configure the extension with your email provider during setup.
3. Deploy the Cloud Functions in `functions`.
4. Provide function parameters when deploying:
   - `APP_NAME` (example: Bloom Florals)
   - `PUBLIC_APP_URL` (example: https://your-site.web.app)
   - `ADMIN_EMAIL` (where admin notifications should go)
   - `SUPPORT_EMAIL` (optional reply-to address)

How it works:
- Functions watch `bookings/{bookingId}` for new bookings and status updates.
- Each change creates a document in the `mail` collection.
- The Trigger Email extension sends the email to the user (and admin).

If `PUBLIC_APP_URL` is set, emails include links to the booking page and payment page.

Security note:
- Client writes to `mail` should remain blocked in Firestore rules so only server functions can enqueue emails.
