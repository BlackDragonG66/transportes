-- MySQL 8.0.16+ / MariaDB 10.6+, InnoDB, UTC. No root grants or CREATE DATABASE required.
CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS users (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), name VARCHAR(120) NOT NULL, email VARCHAR(254) NOT NULL UNIQUE,
 phone VARCHAR(25) NOT NULL, password_hash VARCHAR(100) NOT NULL, role ENUM('customer','cashier','driver','admin') NOT NULL DEFAULT 'customer',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS drivers (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), user_id CHAR(36) NOT NULL UNIQUE, photo_url TEXT NOT NULL, license VARCHAR(120) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS account_tokens (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME(3) NOT NULL, used_at DATETIME(3), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS vehicles (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), brand VARCHAR(80) NOT NULL, model VARCHAR(120) NOT NULL, plate VARCHAR(80) NOT NULL UNIQUE,
 capacity INT NOT NULL CHECK(capacity BETWEEN 1 AND 60), public_token CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()), active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS routes (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), origin VARCHAR(120) NOT NULL, destination VARCHAR(120) NOT NULL,
 kind ENUM('interurban','airport','medical') NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE(origin,destination,kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS passenger_types (id CHAR(36) PRIMARY KEY DEFAULT (UUID()), name VARCHAR(120) NOT NULL UNIQUE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS fares (
 route_id CHAR(36) NOT NULL, passenger_type_id CHAR(36) NOT NULL, price_cents INT NOT NULL CHECK(price_cents>=0), PRIMARY KEY(route_id,passenger_type_id),
 FOREIGN KEY(route_id) REFERENCES routes(id), FOREIGN KEY(passenger_type_id) REFERENCES passenger_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trips (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), route_id CHAR(36) NOT NULL, vehicle_id CHAR(36) NOT NULL, driver_id CHAR(36) NOT NULL,
 departure_at DATETIME(3) NOT NULL, arrival_at DATETIME(3) NOT NULL, capacity INT NOT NULL CHECK(capacity BETWEEN 1 AND 60),
 status ENUM('scheduled','boarding','en_route','arrived','cancelled') NOT NULL DEFAULT 'scheduled',
 CHECK(arrival_at>departure_at), FOREIGN KEY(route_id) REFERENCES routes(id), FOREIGN KEY(vehicle_id) REFERENCES vehicles(id), FOREIGN KEY(driver_id) REFERENCES drivers(id),
 INDEX vehicle_schedule(vehicle_id,departure_at,arrival_at), INDEX driver_schedule(driver_id,departure_at,arrival_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS addons (id CHAR(36) PRIMARY KEY DEFAULT (UUID()), name VARCHAR(120) NOT NULL, price_cents INT NOT NULL CHECK(price_cents>=0), active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS cash_registers (id CHAR(36) PRIMARY KEY DEFAULT (UUID()), name VARCHAR(120) NOT NULL UNIQUE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS cash_sessions (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), register_id CHAR(36) NOT NULL, cashier_id CHAR(36) NOT NULL, opening_cents INT NOT NULL CHECK(opening_cents>=0),
 opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), closed_at DATETIME(3), counted_cents INT CHECK(counted_cents>=0), expected_cents INT, difference_cents INT,
 open_register VARCHAR(36) GENERATED ALWAYS AS (CASE WHEN closed_at IS NULL THEN RTRIM(register_id) ELSE NULL END) STORED,
 open_cashier VARCHAR(36) GENERATED ALWAYS AS (CASE WHEN closed_at IS NULL THEN RTRIM(cashier_id) ELSE NULL END) STORED,
 UNIQUE(open_register), UNIQUE(open_cashier), FOREIGN KEY(register_id) REFERENCES cash_registers(id), FOREIGN KEY(cashier_id) REFERENCES users(id),
 CHECK((closed_at IS NULL AND counted_cents IS NULL AND expected_cents IS NULL AND difference_cents IS NULL) OR
 (closed_at IS NOT NULL AND counted_cents IS NOT NULL AND expected_cents IS NOT NULL AND difference_cents=counted_cents-expected_cents))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS bookings (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), trip_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, channel ENUM('web','pos') NOT NULL, cash_session_id CHAR(36),
 status ENUM('pending','confirmed','expired','cancelled','refund_required','refunded') NOT NULL,
 passengers INT NOT NULL CHECK(passengers BETWEEN 1 AND 60), fare_cents INT NOT NULL CHECK(fare_cents>=0), addon_cents INT NOT NULL CHECK(addon_cents>=0), fee_cents INT NOT NULL,
 total_cents INT NOT NULL CHECK(total_cents>0), expires_at DATETIME(3) NOT NULL,
 ticket_token CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()), share_token CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()), boarded_at DATETIME(3),
 idempotency_key CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL, created_by CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE(created_by,idempotency_key), INDEX booking_capacity(trip_id,status,expires_at),
 FOREIGN KEY(trip_id) REFERENCES trips(id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(cash_session_id) REFERENCES cash_sessions(id),
 CHECK(total_cents=fare_cents+addon_cents+fee_cents),
 CHECK((channel='web' AND cash_session_id IS NULL AND fee_cents=passengers*1000) OR (channel='pos' AND cash_session_id IS NOT NULL AND fee_cents=0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Row locks serialize retries with the same key, including requests on different trips.
CREATE TABLE IF NOT EXISTS booking_keys (
 actor_id CHAR(36) NOT NULL, idempotency_key CHAR(36) NOT NULL, PRIMARY KEY(actor_id,idempotency_key), FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS booking_passengers (
 booking_id CHAR(36) NOT NULL, passenger_type_id CHAR(36) NOT NULL, quantity INT NOT NULL CHECK(quantity>0), unit_cents INT NOT NULL CHECK(unit_cents>=0),
 PRIMARY KEY(booking_id,passenger_type_id), FOREIGN KEY(booking_id) REFERENCES bookings(id), FOREIGN KEY(passenger_type_id) REFERENCES passenger_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS booking_addons (
 booking_id CHAR(36) NOT NULL, addon_id CHAR(36) NOT NULL, quantity INT NOT NULL CHECK(quantity>0), unit_cents INT NOT NULL CHECK(unit_cents>=0),
 PRIMARY KEY(booking_id,addon_id), FOREIGN KEY(booking_id) REFERENCES bookings(id), FOREIGN KEY(addon_id) REFERENCES addons(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS payments (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), booking_id CHAR(36) NOT NULL, provider ENUM('cash','mercadopago') NOT NULL, provider_id VARCHAR(120) UNIQUE,
 status ENUM('approved','refunded','charged_back') NOT NULL, amount_cents INT NOT NULL CHECK(amount_cents>0), created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 approved_booking VARCHAR(36) GENERATED ALWAYS AS (CASE WHEN status='approved' THEN RTRIM(booking_id) ELSE NULL END) STORED,
 UNIQUE(approved_booking), FOREIGN KEY(booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS payment_preferences (
 booking_id CHAR(36) PRIMARY KEY, provider_id VARCHAR(120) NOT NULL UNIQUE, checkout_url TEXT NOT NULL, FOREIGN KEY(booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS local_fleet (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), driver_id CHAR(36) NOT NULL, plate VARCHAR(80) NOT NULL UNIQUE, model VARCHAR(120) NOT NULL, city VARCHAR(120) NOT NULL,
 capacity INT NOT NULL CHECK(capacity BETWEEN 1 AND 4), luggage_capacity INT NOT NULL CHECK(luggage_capacity>=0), active BOOLEAN NOT NULL DEFAULT TRUE, FOREIGN KEY(driver_id) REFERENCES drivers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS last_mile_requests (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), booking_id CHAR(36) NOT NULL UNIQUE, zone VARCHAR(160) NOT NULL, passengers INT NOT NULL CHECK(passengers>0), luggage INT NOT NULL CHECK(luggage>=0), vehicle_count INT NOT NULL CHECK(vehicle_count>0),
 CHECK(vehicle_count>=CEIL(passengers/4)), FOREIGN KEY(booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS local_jobs (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), request_id CHAR(36) NOT NULL, passengers INT NOT NULL CHECK(passengers BETWEEN 1 AND 4), luggage INT NOT NULL CHECK(luggage>=0),
 fleet_id CHAR(36), status ENUM('waiting','accepted','completed','cancelled') NOT NULL DEFAULT 'waiting', accepted_at DATETIME(3),
 active_fleet VARCHAR(36) GENERATED ALWAYS AS (CASE WHEN status='accepted' THEN RTRIM(fleet_id) ELSE NULL END) STORED,
 UNIQUE(active_fleet), CHECK(status IN ('waiting','cancelled') OR fleet_id IS NOT NULL), FOREIGN KEY(request_id) REFERENCES last_mile_requests(id), FOREIGN KEY(fleet_id) REFERENCES local_fleet(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS push_subscriptions (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), user_id CHAR(36) NOT NULL, endpoint TEXT NOT NULL, endpoint_hash CHAR(64) NOT NULL UNIQUE,
 subscription JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS notification_outbox (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), user_id CHAR(36) NOT NULL, title VARCHAR(200) NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, event_key VARCHAR(200) NOT NULL UNIQUE,
 email_sent_at DATETIME(3), push_sent_at DATETIME(3), attempts INT NOT NULL DEFAULT 0,
 next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX outbox_pending(next_attempt_at), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id CHAR(36), action VARCHAR(120) NOT NULL, entity_id CHAR(36) NOT NULL,
 metadata JSON, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO schema_migrations(version) VALUES(1) ON DUPLICATE KEY UPDATE version=version;
CREATE TABLE IF NOT EXISTS booking_travelers (
 booking_id CHAR(36) NOT NULL,
 position TINYINT UNSIGNED NOT NULL,
 full_name VARCHAR(120) NOT NULL,
 passenger_type_id CHAR(36) NOT NULL,
 PRIMARY KEY(booking_id,position),
 FOREIGN KEY(booking_id) REFERENCES bookings(id),
 FOREIGN KEY(passenger_type_id) REFERENCES passenger_types(id),
 CHECK(position BETWEEN 1 AND 60)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
 id VARCHAR(20) PRIMARY KEY,
 settings JSON NOT NULL,
 updated_by CHAR(36) NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_promotions (
 id CHAR(36) PRIMARY KEY,
 title VARCHAR(120) NOT NULL,
 subtitle VARCHAR(300) NOT NULL DEFAULT '',
 image_url VARCHAR(600) NOT NULL,
 button_label VARCHAR(60) NOT NULL DEFAULT 'Ver promoción',
 href VARCHAR(600) NOT NULL DEFAULT '#reservar',
 placement ENUM('banner','promotion') NOT NULL DEFAULT 'promotion',
 sort_order INT NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 starts_at DATETIME(3) NULL,
 ends_at DATETIME(3) NULL,
 updated_by CHAR(36) NULL,
 FOREIGN KEY(updated_by) REFERENCES users(id),
 CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media_assets (
 id CHAR(36) PRIMARY KEY,
 filename VARCHAR(120) NOT NULL,
 sha256 CHAR(64) NOT NULL UNIQUE,
 width INT NOT NULL,
 height INT NOT NULL,
 byte_size INT NOT NULL,
 data MEDIUMBLOB NOT NULL,
 created_by CHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO schema_migrations(version) VALUES(2) ON DUPLICATE KEY UPDATE version=version;

-- Simulated payments have their own ledger, separate from real payments.
CREATE TABLE IF NOT EXISTS demo_entities (
 demo_key VARCHAR(180) PRIMARY KEY, kind VARCHAR(24) NOT NULL, entity_id CHAR(36) NOT NULL,
 UNIQUE KEY demo_entity(kind,entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS demo_state (
 id TINYINT PRIMARY KEY, start_date DATE NULL, end_date DATE NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO demo_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS demo_payments (
 booking_id CHAR(36) PRIMARY KEY, amount_cents INT NOT NULL CHECK(amount_cents>0),
 method ENUM('web','pos') NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS schedule_batches (
 actor_id CHAR(36) NOT NULL, idempotency_key CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL,
 metadata JSON NOT NULL, PRIMARY KEY(actor_id,idempotency_key), FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS parcel_settings (
 id TINYINT PRIMARY KEY, base_cents INT NOT NULL CHECK(base_cents>0),
 included_grams INT NOT NULL CHECK(included_grams>0), extra_kg_cents INT NOT NULL CHECK(extra_kg_cents>=0),
 max_grams INT NOT NULL CHECK(max_grams>0), max_side_cm INT NOT NULL CHECK(max_side_cm>0),
 max_declared_cents INT NOT NULL CHECK(max_declared_cents>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO parcel_settings VALUES(1,12000,5000,1500,30000,100,500000);
CREATE TABLE IF NOT EXISTS trip_cargo (
 trip_id CHAR(36) PRIMARY KEY, max_packages INT NOT NULL CHECK(max_packages BETWEEN 0 AND 200),
 max_grams INT NOT NULL CHECK(max_grams BETWEEN 0 AND 1000000), FOREIGN KEY(trip_id) REFERENCES trips(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS parcels (
 id CHAR(36) PRIMARY KEY, trip_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, created_by CHAR(36) NOT NULL,
 cash_session_id CHAR(36) NULL, sender_name VARCHAR(120) NOT NULL, sender_phone VARCHAR(25) NOT NULL,
 recipient_name VARCHAR(120) NOT NULL, recipient_phone VARCHAR(25) NOT NULL, description VARCHAR(250) NOT NULL,
 grams INT NOT NULL CHECK(grams BETWEEN 1 AND 30000), length_cm INT NOT NULL CHECK(length_cm BETWEEN 1 AND 100),
 width_cm INT NOT NULL CHECK(width_cm BETWEEN 1 AND 100), height_cm INT NOT NULL CHECK(height_cm BETWEEN 1 AND 100),
 declared_cents INT NOT NULL CHECK(declared_cents>=0), total_cents INT NOT NULL CHECK(total_cents>0),
 is_demo BOOLEAN NOT NULL DEFAULT FALSE,
 status ENUM('reserved','received','loaded','in_transit','arrived','delivered','cancelled') NOT NULL DEFAULT 'reserved',
 paid_at DATETIME(3) NULL, expires_at DATETIME(3) NOT NULL, tracking_token CHAR(36) NOT NULL UNIQUE,
 pickup_code VARCHAR(6) NOT NULL, idempotency_key CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY parcel_request(created_by,idempotency_key), INDEX parcel_capacity(trip_id,status,expires_at),
 FOREIGN KEY(trip_id) REFERENCES trips(id), FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(cash_session_id) REFERENCES cash_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS parcel_keys (
 actor_id CHAR(36) NOT NULL, idempotency_key CHAR(36) NOT NULL,
 PRIMARY KEY(actor_id,idempotency_key), FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS parcel_events (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, parcel_id CHAR(36) NOT NULL, status VARCHAR(24) NOT NULL,
 actor_id CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(parcel_id) REFERENCES parcels(id), FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO schema_migrations(version) VALUES(3);

-- A driver may take only one transfer from each interurban arrival, forever.
CREATE TABLE IF NOT EXISTS local_arrival_assignments (
 trip_id CHAR(36) NOT NULL, driver_id CHAR(36) NOT NULL, job_id CHAR(36) NOT NULL UNIQUE,
 PRIMARY KEY(trip_id,driver_id), FOREIGN KEY(trip_id) REFERENCES trips(id),
 FOREIGN KEY(driver_id) REFERENCES drivers(id), FOREIGN KEY(job_id) REFERENCES local_jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Preserve assignments made before this rule, including completed transfers.
INSERT IGNORE INTO local_arrival_assignments(trip_id,driver_id,job_id)
SELECT b.trip_id,f.driver_id,MIN(j.id) FROM local_jobs j
JOIN local_fleet f ON f.id=j.fleet_id JOIN last_mile_requests r ON r.id=j.request_id
JOIN bookings b ON b.id=r.booking_id WHERE j.accepted_at IS NOT NULL
GROUP BY b.trip_id,f.driver_id;
INSERT IGNORE INTO schema_migrations(version) VALUES(4);

CREATE TABLE IF NOT EXISTS trip_driver_acceptances (
 trip_id CHAR(36) PRIMARY KEY, driver_id CHAR(36) NOT NULL, accepted_by CHAR(36) NOT NULL,
 accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(trip_id) REFERENCES trips(id), FOREIGN KEY(driver_id) REFERENCES drivers(id),
 FOREIGN KEY(accepted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Keep already started departures operable after upgrading.
INSERT IGNORE INTO trip_driver_acceptances(trip_id,driver_id,accepted_by)
SELECT t.id,t.driver_id,d.user_id FROM trips t JOIN drivers d ON d.id=t.driver_id
WHERE t.status IN ('boarding','en_route','arrived');
INSERT IGNORE INTO schema_migrations(version) VALUES(5);

-- Separate details preserve existing local_fleet rows and printable QR identities.
CREATE TABLE IF NOT EXISTS local_vehicle_profiles (
 fleet_id CHAR(36) PRIMARY KEY, public_token CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
 brand VARCHAR(80), model VARCHAR(120), vehicle_year SMALLINT, color VARCHAR(40),
 service_type ENUM('taxi','uber'), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CHECK(vehicle_year IS NULL OR vehicle_year BETWEEN 1990 AND 2200),
 FOREIGN KEY(fleet_id) REFERENCES local_fleet(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO local_vehicle_profiles(fleet_id) SELECT id FROM local_fleet;
INSERT IGNORE INTO schema_migrations(version) VALUES(6);

-- Accepted rides form an agenda; only simultaneous arrivals and active driving conflict.
SET @conexiones_fleet_index = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='local_jobs' AND index_name='active_fleet'),'ALTER TABLE local_jobs DROP INDEX active_fleet','DO 0');
PREPARE conexiones_fleet_ddl FROM @conexiones_fleet_index;
EXECUTE conexiones_fleet_ddl;
DEALLOCATE PREPARE conexiones_fleet_ddl;
CREATE TABLE IF NOT EXISTS local_arrival_slots (
 driver_id CHAR(36) NOT NULL, arrival_at DATETIME NOT NULL, job_id CHAR(36) NOT NULL UNIQUE,
 PRIMARY KEY(driver_id,arrival_at), FOREIGN KEY(driver_id) REFERENCES drivers(id), FOREIGN KEY(job_id) REFERENCES local_jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO local_arrival_slots(driver_id,arrival_at,job_id)
SELECT a.driver_id,DATE_FORMAT(t.arrival_at,'%Y-%m-%d %H:%i:00'),MIN(a.job_id)
FROM local_arrival_assignments a JOIN trips t ON t.id=a.trip_id GROUP BY a.driver_id,DATE_FORMAT(t.arrival_at,'%Y-%m-%d %H:%i:00');
CREATE TABLE IF NOT EXISTS local_job_progress (
 job_id CHAR(36) PRIMARY KEY, started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), completed_at DATETIME(3),
 FOREIGN KEY(job_id) REFERENCES local_jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS local_driver_activity (
 driver_id CHAR(36) PRIMARY KEY, job_id CHAR(36) NOT NULL UNIQUE,
 FOREIGN KEY(driver_id) REFERENCES drivers(id), FOREIGN KEY(job_id) REFERENCES local_jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trip_reviews (
 id CHAR(36) PRIMARY KEY DEFAULT (UUID()), booking_id CHAR(36) NOT NULL, subject_key VARCHAR(40) NOT NULL,
 segment ENUM('interurban','local') NOT NULL, job_id CHAR(36), driver_id CHAR(36) NOT NULL,
 rating TINYINT NOT NULL CHECK(rating BETWEEN 1 AND 5), comment VARCHAR(500) NOT NULL DEFAULT '',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE(booking_id,subject_key), FOREIGN KEY(booking_id) REFERENCES bookings(id), FOREIGN KEY(job_id) REFERENCES local_jobs(id), FOREIGN KEY(driver_id) REFERENCES drivers(id),
 CHECK((segment='interurban' AND job_id IS NULL AND subject_key='interurban') OR (segment='local' AND job_id IS NOT NULL AND subject_key=job_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO schema_migrations(version) VALUES(7);
