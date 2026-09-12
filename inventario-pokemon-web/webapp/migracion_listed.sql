-- ============================================================
-- MIGRACIÓN: añade el marcador "ya exportada a Cardmarket"
-- Seguro de ejecutar sobre una base de datos que YA tiene tus
-- datos — no borra ni toca ninguna fila existente.
-- ============================================================

alter table items add column if not exists listed boolean default false;

-- Marca como ya exportadas las colecciones que confirmaste subidas:
-- Phantasmal Flames, Temporal Forces y Pokémon 151.
-- Si alguna de estas NO la subiste en realidad, quita esa línea.
update items set listed = true where set_code in ('PFL', 'TEF', 'MEW');
