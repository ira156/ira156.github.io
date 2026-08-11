-- 赵梓池工作台 · 任务跨设备实时同步表
-- 在 Supabase 控制台 → SQL Editor 里整段执行即可。

-- 任务表：每天一组（day+id 唯一）
create table if not exists tasks (
  day         text        not null,
  id          text        not null,
  title       text        not null,
  prio        smallint    not null default 2,   -- 3 重要 / 2 普通 / 1 低
  done        boolean     not null default false,
  tpl         boolean     not null default false, -- 是否来自每日模板
  created_at  timestamptz not null default now(),
  primary key (day, id)
);
create index if not exists tasks_day_idx on tasks(day);

-- 行级安全：允许匿名（前端 anon key）读写。个人工作台数据本就公开在 Pages 上，可接受。
alter table tasks enable row level security;
drop policy if exists anon_all_tasks on tasks;
create policy anon_all_tasks on tasks for all to anon using (true) with check (true);

-- 开启实时订阅（若已加入会报错，可忽略）
do $$
begin
  begin
    alter publication supabase_realtime add table tasks;
  exception when duplicate_object then null;
  end;
end $$;
