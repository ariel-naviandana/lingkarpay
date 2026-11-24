-- Peran pengguna. Bawaan 'user'; 'admin' hanya diberikan lewat skrip (npm run admin:grant).
ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
