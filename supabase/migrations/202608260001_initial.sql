-- ハッカソン後の実証用スキーマ案。現在のフロントエンドからは未接続。
create extension if not exists postgis with schema extensions;

create type public.observation_status as enum (
  'available',
  'low',
  'sold_out',
  'unknown'
);

create type public.observation_source as enum (
  'user',
  'vendor',
  'operator'
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  category text,
  price_yen integer check (price_yen is null or price_yen > 0),
  created_at timestamptz not null default now()
);

create table public.vending_machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null,
  landmark text,
  location extensions.geography(point, 4326) not null,
  created_at timestamptz not null default now()
);

create index vending_machines_location_idx
  on public.vending_machines
  using gist (location);

create table public.machine_products (
  machine_id uuid not null references public.vending_machines(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  current_status public.observation_status not null default 'unknown',
  status_observed_at timestamptz,
  source public.observation_source,
  primary key (machine_id, product_id)
);

create table public.inventory_reports (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.vending_machines(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  status public.observation_status not null,
  source public.observation_source not null default 'user',
  reporter_id uuid references auth.users(id) on delete set null,
  photo_path text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (status <> 'unknown')
);

create index inventory_reports_lookup_idx
  on public.inventory_reports (machine_id, product_id, observed_at desc);

alter table public.products enable row level security;
alter table public.vending_machines enable row level security;
alter table public.machine_products enable row level security;
alter table public.inventory_reports enable row level security;

create policy "public can read products"
  on public.products for select to anon, authenticated using (true);

create policy "public can read vending machines"
  on public.vending_machines for select to anon, authenticated using (true);

create policy "public can read machine products"
  on public.machine_products for select to anon, authenticated using (true);

create policy "public can read inventory reports"
  on public.inventory_reports for select to anon, authenticated using (true);

create policy "authenticated users can add observations"
  on public.inventory_reports for insert to authenticated
  with check (reporter_id = auth.uid() and source = 'user');

create or replace function public.nearby_machines(
  input_lat double precision,
  input_lng double precision,
  radius_meters integer default 1000
)
returns table (
  id uuid,
  name text,
  area text,
  landmark text,
  distance_meters double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    vm.id,
    vm.name,
    vm.area,
    vm.landmark,
    extensions.st_distance(
      vm.location,
      extensions.st_setsrid(
        extensions.st_makepoint(input_lng, input_lat),
        4326
      )::extensions.geography
    ) as distance_meters
  from public.vending_machines vm
  where extensions.st_dwithin(
    vm.location,
    extensions.st_setsrid(
      extensions.st_makepoint(input_lng, input_lat),
      4326
    )::extensions.geography,
    radius_meters
  )
  order by distance_meters;
$$;
