from __future__ import annotations
import argparse
from contextlib import closing
from getpass import getpass
from db import connect, init_database, transaction
from workflow import user_create

def main():
    parser=argparse.ArgumentParser(description='Создание главного администратора «Бок о бок»')
    parser.add_argument('--name',required=True)
    parser.add_argument('--email',required=True)
    parser.add_argument('--phone',required=True)
    parser.add_argument('--organization',default='Бок о бок')
    args=parser.parse_args()
    password=getpass('Пароль (не менее 12 символов): ')
    if password!=getpass('Повторите пароль: '): raise SystemExit('Пароли не совпадают.')
    init_database()
    with closing(connect()) as db:
        with transaction(db):
            user_create(db,{**vars(args),'full_name':args.name,'role':'super_admin','password':password})
    print('Администратор создан.')

if __name__=='__main__': main()
