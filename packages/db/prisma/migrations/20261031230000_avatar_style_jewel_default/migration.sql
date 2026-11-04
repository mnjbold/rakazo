-- JEWL fork: keep jewel as the default avatar style for new users after upstream's
-- 20261015120000_organic_avatar_default reset it to organic. Existing rows are untouched.
ALTER TABLE "user" ALTER COLUMN "avatarStyle" SET DEFAULT 'jewel';
