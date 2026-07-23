alter table games add column if not exists banner_pos_x real not null default 50;
alter table games add column if not exists banner_pos_y real not null default 50;
alter table creator_profiles add column if not exists banner_pos_x real not null default 50;
alter table creator_profiles add column if not exists banner_pos_y real not null default 50;
