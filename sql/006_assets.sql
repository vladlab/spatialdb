-- ============================================================================
--  006 — assets: files the database refers to but does not contain
-- ============================================================================
--
--  Screenshots pasted into notes, attached PDFs, and later waveform images and
--  other QC output. They cannot live in a field value: every write here is a
--  mutation, kept forever in the log and broadcast to every connected client, so
--  a 3 MB image inside a value would be re-sent to everyone on each edit. This
--  reverses the v1 line in 001_schema.sql ("attachments — media is referenced by
--  absolute path, not uploaded"); that still holds for MEDIA — a 40 GB master is
--  a file_path — but not for the small files that are part of the record itself.
--
--  The BYTES live on disk, beside the Postgres data directory, at
--      <assets dir>/ab/cd/<sha256>
--  and this table is the index: one row per DISTINCT file. Content-addressed, so
--  pasting the same screenshot into ten records stores it once, and a file never
--  changes once written — which is what lets the server tell browsers to cache it
--  forever, and lets the backup be a simple additive mirror.
--
--  Values refer to an asset by `id`, not by hash: the hash is a storage detail,
--  and an id can be re-pointed if the hashing scheme ever changes.
--
--  Deliberately absent: any link from an asset to the records that use it. Usage
--  is whatever the values say; a second copy of that fact here would drift. It
--  also means NOTHING deletes assets yet. A sweep must consider values AND the
--  undo captures of deleted records (an undone delete must find its images), so
--  it shares the log-retention decision — see PLAN.md, "retention is one number".

create table assets (
  id          uuid primary key default gen_random_uuid(),
  sha256      text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  mime        text not null,
  bytes       bigint not null check (bytes >= 0),
  -- Pixel size, for images. Lets the client reserve space before the image loads
  -- (no layout jump) without fetching it. Null for PDFs.
  width       integer,
  height      integer,
  -- The name it was uploaded under, for download and display. NOT unique and not
  -- part of identity: the first uploader's name wins for a given file.
  name        text not null default '',
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default clock_timestamp()
);
