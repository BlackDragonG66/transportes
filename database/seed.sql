START TRANSACTION;
INSERT INTO routes(origin,destination,kind) VALUES
 ('Apatzingán','Morelia','interurban'),('Morelia','Apatzingán','interurban'),
 ('Apatzingán','Aeropuerto de Morelia','airport'),('Aeropuerto de Morelia','Apatzingán','airport'),
 ('Apatzingán','CREE Morelia','medical'),('CREE Morelia','Apatzingán','medical'),
 ('Apatzingán','Teletón Morelia','medical'),('Teletón Morelia','Apatzingán','medical') ON DUPLICATE KEY UPDATE origin=origin;
INSERT INTO passenger_types(name) VALUES('Adulto'),('Niño'),('Persona mayor'),('Madre con niño con discapacidad') ON DUPLICATE KEY UPDATE name=name;
INSERT INTO fares(route_id,passenger_type_id,price_cents)
 SELECT r.id,p.id,CASE p.name WHEN 'Niño' THEN 15000 WHEN 'Persona mayor' THEN 18000 WHEN 'Madre con niño con discapacidad' THEN 15000 ELSE 25000 END FROM routes r CROSS JOIN passenger_types p WHERE TRUE
 ON DUPLICATE KEY UPDATE price_cents=fares.price_cents;
INSERT INTO addons(name,price_cents) SELECT 'Bebida + Sándwich',6500 WHERE NOT EXISTS(SELECT 1 FROM addons);
INSERT INTO cash_registers(name) VALUES('Taquilla Apatzingán'),('Taquilla Morelia') ON DUPLICATE KEY UPDATE name=name;
COMMIT;
