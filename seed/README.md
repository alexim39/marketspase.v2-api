# IPO course snapshot

This folder preserves the exact **Initial Planning Orientation (IPO)** training records from the `marketspaseV2` database.

## What is preserved

- Course ID: `6af43d2a78d4a0509fd40a0f`
- Course title: **Initial Planning Orientation (IPO)**
- Status: **published**
- Rank milestone: **IPO**
- Four published lessons with original lesson IDs
- Course title, tagline and description
- Lesson summaries, full study notes and key takeaways
- YouTube IDs, watch URLs, thumbnails and durations
- Video summaries / transcripts
- All **17 quiz questions**, options and correct-answer indexes
- Original created/updated timestamps and `__v` metadata

Snapshot file: `ipo-course.snapshot.json`  
Integrity checksum: `ipo-course.snapshot.sha256`

## Restore after the database is wiped

From `api/`:

```bash
# Check what will be restored — no writes
npm run restore:ipo

# Restore the exact records
# macOS/Linux
APPLY=1 npm run restore:ipo

# Windows PowerShell
$env:APPLY="1"; npm run restore:ipo; Remove-Item Env:APPLY
```

The script uses the raw MongoDB driver, preserves the original ids and timestamps, and is idempotent.

## Important notes

- The snapshot contains quiz answer keys. Keep the repository private.
- The original admin id is stored in `createdBy` / `updatedBy` as part of the exact record. If the admin account is recreated with a different id after the wipe, the course still works normally; those metadata references will just point to the old id.
- The restore script only restores this IPO course and its lessons. It does not restore partners, progress, certificates, transactions or other collections.
- `seed-ipo-course.js` remains a content-only seed utility. Use `restore:ipo` when exact reproduction is required.
