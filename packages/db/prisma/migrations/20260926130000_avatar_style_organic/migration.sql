-- New accounts start with the living (organic) avatar; existing choices are kept.
ALTER TABLE "user" ALTER COLUMN "avatarStyle" SET DEFAULT 'organic';
