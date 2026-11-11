# IPO course snapshot

This folder preserves the exact **Initial Planning Orientation (IPO)**, **Quick Start Guide (QSG)**, **Standard Method of Operation (SMO)** and **Leadership Development** training records from the `marketspaseV2` database.

## Files

- `ipo-course.snapshot.json` — exact IPO course and four lessons.
- `remaining-courses.snapshot.json` — exact QSG, SMO and Leadership courses with ten lessons.
- Matching `.sha256` files — integrity checks.
- `README.md` — this document.

## What is preserved

### IPO

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

### QSG, SMO and Leadership

- Three published courses, ten published lessons and **46 quiz questions** in total.
- Original course and lesson IDs.
- All notes, takeaways, transcripts, YouTube IDs, thumbnails and durations.
- All quiz options and correct-answer indexes.
- Original timestamps and metadata.

## Restore after the database is wiped

From `api/`:

```bash
# IPO only — check first, then apply
npm run restore:ipo
APPLY=1 npm run restore:ipo

# QSG, SMO and Leadership — check first, then apply
npm run restore:courses
APPLY=1 npm run restore:courses
```

On Windows PowerShell:

```powershell
$env:APPLY="1"; npm run restore:ipo; Remove-Item Env:APPLY
$env:APPLY="1"; npm run restore:courses; Remove-Item Env:APPLY
```

The restore scripts use the raw MongoDB driver, preserve the original ids and timestamps, and are idempotent.

## Important notes

- The snapshots contain quiz answer keys. Keep the repository private.
- The original admin id is stored in `createdBy` / `updatedBy` as part of the exact records. If the admin account is recreated with a different id after a wipe, the courses still work normally; those metadata references will point to the old id.
- The restore scripts only restore training courses and lessons. They do not restore partners, progress, certificates, transactions or other collections.
- `seed-ipo-course.js` and `seed-remaining-courses.js` are content seed utilities. Use the `restore:*` commands when exact reproduction is required.
