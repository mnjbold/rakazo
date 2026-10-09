-- New accounts start with the jewel character; existing choices are kept.
-- Revert: ALTER TABLE "user" ALTER COLUMN "avatarStyle" SET DEFAULT 'organic';
ALTER TABLE "user" ALTER COLUMN "avatarStyle" SET DEFAULT 'jewel';
