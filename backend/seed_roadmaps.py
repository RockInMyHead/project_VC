"""Import two user-supplied roadmaps as published, attributed project examples.

Run explicitly after backup: python backend/seed_roadmaps.py [--founder-email EMAIL]
Existing projects with the same codes are left untouched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from db import DB_PATH, connect, public_id, transaction, utc_now
from server import create_founder_project

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'seed_assets'
UPLOADS = DB_PATH.parent / 'uploads'


def node(title, year, ugt, parent=None, status='planned', description='', month=6, day=15):
    return dict(title=title, due_at=f'{year}-{month:02d}-{day:02d}' if year else None,
                ugt_level=ugt, parent=parent, status=status,
                description=description)


def build_agct():
    stages=[]
    def add(*args, **kwargs):
        value=node(*args, **kwargs); value['id']=len(stages)+1; stages.append(value); return value['id']
    source='По схеме развития, предоставленной автором проекта. Контрольная дата ориентировочная: на схеме указан только год.'
    a=add('Технологическая основа',2016,2,status='completed',description='Научная база CCR5-TALEN. '+source)
    add('Права на CCR5-TALEN',2016,2,a,'completed','Правовой маршрут технологии. '+source)
    add('Минигрант Сколково',2016,2,a,'completed','Первичное финансирование НИР. '+source)
    add('Инвестиционные договоры',2017,3,a,'completed','Договорная база дальнейшего развития. '+source)
    b=add('Начало НИР',2017,3,a,'completed','Освоение УГТ 3; постановка исследовательской программы. '+source)
    c=add('Исследования в США',2021,4,b,'completed','Этап исследований, обозначенный в исходной карте. '+source)
    d=add('Пять прототипов',2022,4,c,'completed','Пять прототипов по авторской карте; подтверждающие отчёты не приложены. '+source)
    e=add('Доклинические исследования',2024,5,d,'completed','Период 2023–2024; переход между УГТ 4 и 5. '+source)
    f=add('Внешняя экспертиза',2025,5,e,'completed','Рецензирование результатов и маршрута развития. '+source)
    g=add('Производство и документы',2026,5,f,'in_progress','Период 2026–2027: подготовка производства и документации; целевой УГТ 5. '+source)
    add('Финансирование',2026,5,g,'in_progress','Поиск финансирования для следующего этапа программы.')
    h=add('Решение по ГИ',2027,5,g,'planned','Развилка по разрешительной документации. '+source,month=12)
    permit=add('Разрешение',2027,5,h,'planned','Переход к клиническому маршруту при получении разрешения.',month=12)
    comments=add('Замечания',2027,5,h,'planned','Возврат документов на доработку.',month=12)
    refusal=add('Отказ',2027,5,h,'planned','Пересмотр маршрута программы.',month=12)
    add('Доработка документов',2028,5,comments,'planned','Устранение замечаний и повторная подача.',month=3)
    add('Пересмотр маршрута',2028,5,refusal,'planned','Оценка причин отказа и возможных альтернатив.',month=3)
    p=add('Пациенты № 1–5',2028,6,permit,'planned','Начало этапа в рамках пути к УГТ 6 при необходимых разрешениях.',month=3)
    q=add('Завершение наблюдения',2028,6,p,'planned','Сбор данных наблюдения.',month=11)
    poc=add('Оценка PoC',2029,6,q,'planned','Оценка proof of concept, в исходной схеме указан январь 2029 года.',month=1)
    success=add('Положительный результат',2029,6,poc,'planned','Переход к следующей клинической программе.',month=3)
    add('Дополнительные исследования',2029,6,poc,'planned','Ветвь при недостаточности данных.',month=3)
    add('Пересмотр программы',2029,5,poc,'planned','Ветвь при отрицательном результате.',month=3)
    trial=add('Клинические исследования',2030,7,success,'planned','Целевой переход к УГТ 6–7; сроки после PoC ориентировочны.')
    reg=add('Регистрационный этап',2032,8,trial,'planned','Регистрационный маршрут, плановый УГТ 8.')
    add('Применение в практике',2034,9,reg,'planned','Долгосрочная цель, УГТ 9; зависит от результатов и разрешений.')
    return stages, a


def build_yeast():
    stages=[]
    def add(*args, **kwargs):
        value=node(*args, **kwargs); value['id']=len(stages)+1; stages.append(value); return value['id']
    note='По схеме, предоставленной автором. Контрольные даты ориентировочные: точный календарь в схеме не указан.'
    a=add('Продуцент глютеназы для пивоварения',2026,2,status='in_progress',description='Исходная идея: ферментный маршрут снижения глютена в продукте пивоварения. '+note,month=10)
    b=add('Создание коллекции штаммов',2026,3,a,'in_progress','Собрать и описать коллекцию для скрининга; путь к УГТ 3. '+note,month=11)
    c=add('Условия процесса от партнёра',2026,3,b,'planned','Получить характеристики процесса для релевантного отбора штаммов. '+note,month=12)
    d=add('Скрининг в условиях пивоварения',2027,3,c,'planned','Проверить активность в модельных условиях пивоварения. '+note,month=2)
    e=add('Отбор активных штаммов',2027,3,d,'planned','Охарактеризовать активные штаммы; целевой УГТ 3. '+note,month=4)
    f=add('Тест фермента S. cerevisiae',2027,3,e,'planned','Отдельная научная ветвь для проверки фермента. '+note,month=5)
    decision=add('Нативный продуцент пригоден?',2027,3,f,'planned','Развилка выбора маршрута получения фермента. '+note,month=6)
    native=add('Фермент из нативного штамма',2027,4,decision,'planned','Ветвь «Да»: выделение фермента из нативного штамма. '+note,month=8)
    recomb=add('Рекомбинантный маршрут',2027,4,decision,'planned','Ветвь «Нет»: создание нового продуцента, путь к УГТ 4. '+note,month=8)
    g=add('Дизайн и синтез гена',2027,4,recomb,'planned','Расчётная длительность по схеме — 2 месяца. '+note,month=10)
    h=add('Экспрессионные конструкции',2028,4,g,'planned','Расчётная длительность — 4 месяца. '+note,month=2)
    i=add('Продуцент Pichia',2028,4,h,'planned','Создание продуцента; расчётная длительность — 2 месяца. '+note,month=4)
    j=add('Ферментация и первичная очистка',2028,4,i,'planned','Расчётная длительность — 8 месяцев. '+note,month=12)
    k=add('Второй раунд оптимизации',2029,4,j,'planned','Расчётная длительность — 8 месяцев. '+note,month=8)
    purification=add('Разработка очистки фермента',2029,4,k,'planned','Сопоставить с нативным маршрутом; цель УГТ 4. '+note,month=10)
    add('Контроль нативного маршрута',2029,4,native,'planned','Подготовить нативный фермент к общему сравнению. '+note,month=10)
    compare=add('Сравнение на одном сусле',2030,5,purification,'planned','Один базовый эксперимент и штатные лагерные дрожжи; цель УГТ 5. '+note,month=1)
    add('Контроль без фермента',2030,5,compare,'planned','Контрольная группа без дополнительного фермента. '+note,month=2)
    add('Коммерческий фермент',2030,5,compare,'planned','Референсная группа с коммерческим ферментом. '+note,month=2)
    new=add('Новая глютеназа',2030,5,compare,'planned','Экспериментальная группа с новым ферментом. '+note,month=2)
    evaln=add('Оценка глютена, брожения и вкуса',2030,5,new,'planned','Сопоставить уровень глютена, брожение, вкус и стоимость. '+note,month=4)
    decision2=add('Целевые показатели достигнуты?',2030,5,evaln,'planned','Развилка по итогам сопоставления трёх групп. '+note,month=5)
    yes=add('Пилотная демонстрация',2030,6,decision2,'planned','Ветвь «Да», целевой УГТ 6. '+note,month=10)
    add('Доработка фермента или процесса',2030,5,decision2,'planned','Ветвь «Частично»: оптимизация и повторная оценка. '+note,month=10)
    add('Пересмотр продуцента',2030,4,decision2,'planned','Ветвь «Нет»: возврат к выбору продуцента. '+note,month=10)
    industrial=add('Промышленная демонстрация',2031,7,yes,'planned','Целевой УГТ 7. '+note)
    readiness=add('Готовность к выпуску технологии',2032,8,industrial,'planned','Подтверждение производственной готовности, целевой УГТ 8. '+note)
    add('Регулярное производство',2033,9,readiness,'planned','Долгосрочная цель: внедрение и применение, УГТ 9. '+note)
    return stages,b


PROJECTS=[
    dict(code='AGCT-HIV',name='AGCT — терапия ВИЧ',summary='Дорожная карта терапии ВИЧ на основе технологии CCR5-TALEN.',
         description='Авторская дорожная карта развития технологии CCR5-TALEN: от научной основы и НИР до прототипов, доклиники, разрешительного маршрута, PoC и возможного клинического применения. Даты и будущие результаты являются планом, а не подтверждением эффективности или разрешения на применение. Источник — приложенная автором схема.',field='Генная терапия',ugt_level=5,build=build_agct,attachment='agct-roadmap.jpg'),
    dict(code='GLUTEN-FREE-YEAST',name='Генно-модифицированные дрожжи «Глютен-фри»',summary='Разработка продуцента глютеназы и проверка технологии в пивоварении.',
         description='Авторская дорожная карта: коллекция штаммов, скрининг, выбор нативного или рекомбинантного маршрута, разработка очистки фермента и сравнение в одинаковых условиях пивоварения. Пилотная и промышленная демонстрация зависят от измерений глютена, параметров брожения, вкуса и стоимости. Будущие результаты и даты указаны как план. Источник — приложенная автором схема.',field='Промышленная биотехнология',ugt_level=2,build=build_yeast,attachment='yeast-roadmap.jpg'),
]


def add_material(db, stage_id, user_id, filename, title, mime):
    source=ASSETS/filename
    key=f'{public_id("asset")}{source.suffix}'
    target=UPLOADS/key
    UPLOADS.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,target)
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    db.execute('INSERT INTO evidence(public_id,stage_id,title,storage_key,mime_type,byte_size,checksum_sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?)',
               (public_id('mat'),stage_id,title,'file:'+key,mime,target.stat().st_size,digest,user_id))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--founder-email',help='Email активного основателя проекта')
    args=parser.parse_args()
    db=connect()
    try:
        if args.founder_email:
            founder=db.execute("SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=? AND u.status='active' AND r.code='founder'",(args.founder_email,)).fetchone()
        else:
            founder=db.execute("SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' AND r.code='founder' ORDER BY CASE WHEN u.email='artem@mail.ru' THEN 0 ELSE 1 END,u.id LIMIT 1").fetchone()
        if not founder: raise SystemExit('Не найден активный основатель. Укажите --founder-email.')
        admin=db.execute("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='super_admin' AND u.status='active' ORDER BY u.id LIMIT 1").fetchone()
        if not admin: raise SystemExit('Не найден активный главный администратор для публикации.')
        print('Основатель:',founder['email'])
        with transaction(db):
            for spec in PROJECTS:
                if db.execute('SELECT 1 FROM projects WHERE code=?',(spec['code'],)).fetchone():
                    print('Уже существует:',spec['code']);continue
                stages,source_stage=spec['build']()
                data={key:spec[key] for key in ('code','name','summary','description','field','ugt_level')}
                data['region']='Россия';data['stages']=stages
                created=create_founder_project(db,founder,data)
                if not created: raise RuntimeError('Не удалось создать '+spec['code'])
                project=db.execute('SELECT id FROM projects WHERE public_id=?',(created['public_id'],)).fetchone()
                now=utc_now()
                db.execute("UPDATE tree_versions SET state='published',reviewed_by=?,reviewed_at=?,published_at=?,change_summary=? WHERE public_id=?",
                           (admin['id'],now,now,'Импорт авторской дорожной карты и материалов',created['tree_version']))
                db.execute("UPDATE projects SET status='active',last_published_at=?,updated_at=? WHERE id=?",(now,now,project['id']))
                src_id=db.execute('SELECT id FROM stages WHERE public_id=?',(created['stage_ids'][str(source_stage)],)).fetchone()['id']
                add_material(db,src_id,founder['id'],spec['attachment'],'Авторская схема дорожной карты','image/jpeg')
                if spec['code']=='GLUTEN-FREE-YEAST':
                    add_material(db,src_id,founder['id'],'lab-closeup.mp4','Лабораторная работа — иллюстративное видео (крупный план)','video/mp4')
                db.execute("INSERT INTO audit_log(public_id,actor_id,action,entity_type,entity_public_id,metadata_json) VALUES(?,?,'project.published','project',?,?)",
                           (public_id('aud'),admin['id'],created['public_id'],json.dumps({'source':'user-supplied roadmap','stage_count':len(stages)},ensure_ascii=False)))
                print(f"Создан {spec['code']}: {len(stages)} этапов, {created['public_id']}")
    finally: db.close()

if __name__=='__main__': main()
