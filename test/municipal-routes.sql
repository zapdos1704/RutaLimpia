-- Tras las migraciones y el fixture 007/02_seed, en un PostGIS desechable.
begin;
set local search_path=public,extensions;
insert into municipalities values ('ciudad-b','Ciudad B');
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a2'),('00000000-0000-0000-0000-0000000000d2');
insert into users(id,name,role) values ('00000000-0000-0000-0000-0000000000a2','Admin B','admin'),('00000000-0000-0000-0000-0000000000d2','Luis','collector');
insert into municipal_members values
 ('00000000-0000-0000-0000-0000000000a1','sahuayo',true),
 ('00000000-0000-0000-0000-0000000000a2','ciudad-b',true),
 ('00000000-0000-0000-0000-0000000000d1','sahuayo',false),
 ('00000000-0000-0000-0000-0000000000d2','sahuayo',false);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
select save_municipal_route('{"name":"Comercio rural","zone":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"color":"#225588","start":[0.2,0.1],"end":[0.8,0.5],"line":{"type":"LineString","coordinates":[[0.2,0.1],[0.8,0.5]]},"mode":"manual","legacy_type":"commercial"}','commercial','rural','{"mode":"predefined","learning":false}') as created \gset
select set_config('test.created', :'created',true);
do $$ begin
  assert (select author_id=auth.uid() and can_edit and service_kind='commercial' and area_kind='rural' from municipal_route_plans where id=current_setting('test.created')::uuid) is true;
  update routes set description='Por el autor' where id=current_setting('test.created')::uuid;
  assert found;
  assert (select count(*) from municipal_members)=3;
  assert (select count(*) from users where role in ('admin','driver','collector'))=3;
  assert jsonb_array_length(municipal_fleet_scope()->'vehicles')=2;
  perform save_municipal_route(jsonb_build_object('id',current_setting('test.created'),'expected',
    (select updated_at from routes where id=current_setting('test.created')::uuid),'name','Comercio redibujado','color','#225588',
    'zone','{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}'::jsonb,'start','[0.3,0.1]'::jsonb,'end','[0.9,0.4]'::jsonb,
    'line','{"type":"LineString","coordinates":[[0.3,0.1],[0.9,0.4]]}'::jsonb,'mode','manual'),'commercial','urban','{"mode":"predefined","learning":false}');
  assert (select area_kind='urban' and name='Comercio redibujado' from routes where id=current_setting('test.created')::uuid) is true;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d2';
do $$ begin
  assert (select not can_edit from municipal_route_plans where id=current_setting('test.created')::uuid) is true;
  update routes set description='Edición ajena' where id=current_setting('test.created')::uuid;
  assert not found;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a2';
do $$ begin
  assert not exists(select 1 from municipal_route_plans);
  assert not exists(select 1 from vehicles);
  update routes set name='Otra ciudad' where id=current_setting('test.created')::uuid;
  assert not found;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000c1';
do $$ begin assert rl_city() is null; assert not exists(select 1 from municipal_route_plans); end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert (select author_id is null and can_edit from municipal_route_plans where name='Ruta Centro') is true;
  update routes set author_id='00000000-0000-0000-0000-0000000000d2' where name='Ruta Centro';
  assert found;
  update routes set is_active=false where id=current_setting('test.created')::uuid;
  assert found;
  insert into campaigns(id) values ('00000000-0000-0000-0000-00000000cafe');
  assert (select municipality_id from campaigns where id='00000000-0000-0000-0000-00000000cafe')='sahuayo';
  update campaigns set municipality_id='sahuayo' where id='00000000-0000-0000-0000-00000000cafe';
  assert found;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d2';
do $$ begin
  assert exists(select 1 from campaigns where id='00000000-0000-0000-0000-00000000cafe');
  delete from campaigns where id='00000000-0000-0000-0000-00000000cafe';
  assert not found;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
do $$ begin
  delete from campaigns where id='00000000-0000-0000-0000-00000000cafe';
  assert found;
end $$;
insert into municipal_devices(device_key,device_type,model,vehicle_id) values('gps-1','GPS','Equipo de prueba','00000000-0000-0000-0000-00000000e001');
reset role;
select record_municipal_fix('gps-1','00000000-0000-0000-0000-00000000e002',now(),-102.723,20.0100);
select record_municipal_fix('gps-1','00000000-0000-0000-0000-00000000e001',now()-interval '5 minutes',-102.723,19.9910);
set local role authenticated;
do $$ begin
  assert (select detected_routes=array['Ruta Norte'] and vehicle_id<>reported_vehicle from municipal_device_monitor where device_key='gps-1') is true;
  assert not exists(select 1 from municipal_route_plans where id=current_setting('test.created')::uuid and is_active);
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a2';
do $$ begin assert not exists(select 1 from municipal_device_monitor); end $$;
rollback;
