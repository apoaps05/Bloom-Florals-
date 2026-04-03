const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const asString = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

const buildLocation = (data) => {
  const location = data.location || {};
  return {
    type: asString(location.type) || asString(data.locationType),
    name: asString(location.name) || asString(data.locationName),
    province:
      asString(location.province) ||
      asString(data.locationProvince) ||
      asString(data.province),
    city:
      asString(location.city) ||
      asString(data.locationCity) ||
      asString(data.city),
    barangay: asString(location.barangay) || asString(data.locationBarangay),
    street: asString(location.street) || asString(data.locationStreet),
    unit: asString(location.unit) || asString(data.locationUnit),
    landmark: asString(location.landmark) || asString(data.locationLandmark),
    postalCode:
      asString(location.postalCode) || asString(data.locationPostalCode),
    notes:
      asString(location.notes) ||
      asString(data.locationNotes) ||
      asString(data.venueNotes),
  };
};

const hasLegacyLocationData = (data) =>
  Boolean(
    data.locationType ||
      data.locationName ||
      data.locationProvince ||
      data.locationCity ||
      data.locationBarangay ||
      data.locationStreet ||
      data.locationUnit ||
      data.locationLandmark ||
      data.locationPostalCode ||
      data.locationNotes ||
      data.city ||
      data.province
  );

const run = async () => {
  const snapshot = await db.collection("bookings").get();
  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;
  let skipped = 0;
  const dryRun = process.env.DRY_RUN === "true";

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (data.bookingType === "seminar") {
      skipped += 1;
      continue;
    }

    const hasLocationObject =
      data.location && typeof data.location === "object" && Object.keys(data.location).length;
    const hasLegacy = hasLegacyLocationData(data);

    if (!hasLocationObject && !hasLegacy) {
      skipped += 1;
      continue;
    }

    const update = {};
    if (!hasLocationObject) {
      update.location = buildLocation(data);
    }
    const fieldsToDelete = [
      "locationType",
      "locationName",
      "locationProvince",
      "locationCity",
      "locationBarangay",
      "locationStreet",
      "locationUnit",
      "locationLandmark",
      "locationPostalCode",
      "locationNotes",
      "city",
      "province",
    ];

    fieldsToDelete.forEach((field) => {
      if (data[field] !== undefined) {
        update[field] = admin.firestore.FieldValue.delete();
      }
    });

    if (!Object.keys(update).length) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[DRY RUN] Would update ${docSnap.id}`, update);
      updated += 1;
      continue;
    }

    batch.update(docSnap.ref, update);
    batchCount += 1;
    updated += 1;

    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (!dryRun && batchCount > 0) {
    await batch.commit();
  }

  console.log(
    `Migration complete. Updated: ${updated}. Skipped: ${skipped}. Dry run: ${dryRun}.`
  );
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
