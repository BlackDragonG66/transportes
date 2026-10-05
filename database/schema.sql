BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
 phone text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','cashier','driver','admin')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE drivers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id),
 photo_url text NOT NULL, license text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE account_tokens (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', used_at timestamptz
);
CREATE TABLE vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand text NOT NULL, model text NOT NULL,
 plate text NOT NULL UNIQUE, capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 60),
 public_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), active boolean NOT NULL DEFAULT true
);
CREATE TABLE routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origin text NOT NULL, destination text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('interurban','airport','medical')), active boolean NOT NULL DEFAULT true,
 UNIQUE(origin,destination,kind)
);
CREATE TABLE passenger_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE fares (
 route_id uuid REFERENCES routes(id), passenger_type_id uuid REFERENCES passenger_types(id),
 price_cents integer NOT NULL CHECK (price_cents >= 0), PRIMARY KEY(route_id,passenger_type_id)
);
CREATE TABLE trips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), route_id uuid NOT NULL REFERENCES routes(id),
 vehicle_id uuid NOT NULL REFERENCES vehicles(id), driver_id uuid NOT NULL REFERENCES drivers(id),
 departure_at timestamptz NOT NULL, arrival_at timestamptz NOT NULL,
 capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 60),
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','boarding','en_route','arrived','cancelled')),
 CHECK(arrival_at > departure_at)
);
CREATE TABLE addons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, price_cents integer NOT NULL CHECK(price_cents >= 0), active boolean NOT NULL DEFAULT true);
CREATE TABLE cash_registers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE cash_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), register_id uuid NOT NULL REFERENCES cash_registers(id),
 cashier_id uuid NOT NULL REFERENCES users(id), opening_cents integer NOT NULL CHECK(opening_cents >= 0),
 opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 counted_cents integer CHECK(counted_cents >= 0), expected_cents integer, difference_cents integer,
 CHECK ((closed_at IS NULL AND counted_cents IS NULL AND expected_cents IS NULL AND difference_cents IS NULL) OR
 (closed_at IS NOT NULL AND counted_cents IS NOT NULL AND expected_cents IS NOT NULL AND difference_cents = counted_cents - expected_cents))
);
CREATE UNIQUE INDEX one_open_register ON cash_sessions(register_id) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX one_open_cashier ON cash_sessions(cashier_id) WHERE closed_at IS NULL;
CREATE TABLE bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trip_id uuid NOT NULL REFERENCES trips(id), user_id uuid NOT NULL REFERENCES users(id),
 channel text NOT NULL CHECK(channel IN ('web','pos')), cash_session_id uuid REFERENCES cash_sessions(id),
 status text NOT NULL CHECK(status IN ('pending','confirmed','expired','cancelled','refund_required','refunded')),
 passengers integer NOT NULL CHECK(passengers BETWEEN 1 AND 60), fare_cents integer NOT NULL CHECK(fare_cents >= 0),
 addon_cents integer NOT NULL CHECK(addon_cents >= 0), fee_cents integer NOT NULL,
 total_cents integer NOT NULL CHECK(total_cents > 0), expires_at timestamptz NOT NULL,
 ticket_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), share_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 boarded_at timestamptz, idempotency_key uuid NOT NULL, request_hash text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(created_by,idempotency_key), CHECK(total_cents = fare_cents + addon_cents + fee_cents),
 CHECK ((channel='web' AND cash_session_id IS NULL AND fee_cents=passengers*1000) OR
 (channel='pos' AND cash_session_id IS NOT NULL AND fee_cents=0))
);
CREATE INDEX booking_capacity ON bookings(trip_id,status,expires_at);
CREATE TABLE booking_passengers (
 booking_id uuid REFERENCES bookings(id), passenger_type_id uuid REFERENCES passenger_types(id),
 quantity integer NOT NULL CHECK(quantity > 0), unit_cents integer NOT NULL CHECK(unit_cents >= 0), PRIMARY KEY(booking_id,passenger_type_id)
);
CREATE TABLE booking_addons (
 booking_id uuid REFERENCES bookings(id), addon_id uuid REFERENCES addons(id), quantity integer NOT NULL CHECK(quantity > 0),
 unit_cents integer NOT NULL CHECK(unit_cents >= 0), PRIMARY KEY(booking_id,addon_id)
);
CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
 provider text NOT NULL CHECK(provider IN ('cash','mercadopago')), provider_id text UNIQUE,
 status text NOT NULL CHECK(status IN ('approved','refunded','charged_back')),
 amount_cents integer NOT NULL CHECK(amount_cents > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_approved_payment ON payments(booking_id) WHERE status='approved';
CREATE TABLE payment_preferences (
 booking_id uuid PRIMARY KEY REFERENCES bookings(id), provider_id text NOT NULL UNIQUE, checkout_url text NOT NULL
);
CREATE TABLE local_fleet (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES drivers(id),
 plate text NOT NULL UNIQUE, model text NOT NULL, city text NOT NULL,
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 4), luggage_capacity integer NOT NULL CHECK(luggage_capacity >= 0),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE last_mile_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
 zone text NOT NULL, passengers integer NOT NULL CHECK(passengers > 0), luggage integer NOT NULL CHECK(luggage >= 0),
 vehicle_count integer NOT NULL CHECK(vehicle_count > 0), CHECK(vehicle_count >= (passengers+3)/4)
);
CREATE TABLE local_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES last_mile_requests(id),
 passengers integer NOT NULL CHECK(passengers BETWEEN 1 AND 4), luggage integer NOT NULL CHECK(luggage >= 0),
 fleet_id uuid REFERENCES local_fleet(id), status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','accepted','completed','cancelled')),
 accepted_at timestamptz, CHECK ((status IN ('waiting','cancelled')) OR fleet_id IS NOT NULL)
);
CREATE UNIQUE INDEX one_active_local_job ON local_jobs(fleet_id) WHERE status='accepted';
CREATE TABLE push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), endpoint text NOT NULL UNIQUE,
 subscription jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL, body text NOT NULL, url text NOT NULL, event_key text NOT NULL UNIQUE,
 email_sent_at timestamptz, push_sent_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON notification_outbox(next_attempt_at) WHERE email_sent_at IS NULL OR push_sent_at IS NULL;
CREATE TABLE audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL,
 entity_id uuid NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(1);
COMMIT;
