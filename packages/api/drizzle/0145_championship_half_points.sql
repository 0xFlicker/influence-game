-- Binary half points are exact in double precision, as are all historical int32 values.
-- Do not rescale historical scores or rewrite their policy versions.
ALTER TABLE championship_results ALTER COLUMN points TYPE double precision USING points::double precision;
--> statement-breakpoint
ALTER TABLE championship_results ADD CONSTRAINT championship_result_points CHECK (points >= 0 AND points <= 2147483647 AND points * 2 = floor(points * 2));
