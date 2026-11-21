-- Le funzioni del cestino accedono alla tabella come proprietario.
-- RLS mantiene chiuso l’accesso diretto anche in presenza di grant futuri.
alter table imprelio_private.trashed_records enable row level security;
