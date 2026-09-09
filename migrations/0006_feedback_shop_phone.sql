-- Optional shop-bound phone, stored per submission without country/format restrictions.
ALTER TABLE feedback ADD COLUMN shop_phone TEXT DEFAULT NULL;
