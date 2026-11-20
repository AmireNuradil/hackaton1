# FinTech Audit RL

Симулятор аудита синтетической бухгалтерии. Агент исследует главную книгу, счета, платежи и FX-котировки через JSON API и отправляет выводы с доказательствами. Отдельный оценщик проверяет их по закрытому эталону. Для запуска достаточно CPU.

## Запуск

На Linux с Python 3.11 и доступом к пользовательским пространствам имён выполните из корня проекта:

```bash
./run_verify.sh
```

Если Python 3.11 установлен по другому пути, используйте `PYTHON=/path/to/python3.11 ./run_verify.sh`. Скрипт проверяет контрольные суммы включённых pytest-зависимостей, запускает тесты и сравнивает заново сгенерированные эпизоды и траектории с сохранёнными файлами.

Docker-вариант с двумя CPU и 4 ГБ RAM:

```bash
docker build --network none -t fintech-audit-rl . && docker run --rm --network none --cpus=2 --memory=4g --cap-drop=ALL --cap-add=SYS_CHROOT --cap-add=SETUID --cap-add=SETGID --security-opt=no-new-privileges fintech-audit-rl
```

Для сборки без интернета заранее подготовьте базовый образ из `FROM`. Все Python-зависимости уже включены в проект. Для оценки внутри контейнера сеть отключена.

## Данные

| Путь | Содержимое |
|---|---|
| `data/{train,dev}/public/{01..10}/` | Шесть файлов эпизода. В CSV пустое поле связи возвращается агенту как JSON `null`. |
| `data/{train,dev}/private/{01..10}/` | `truth.json` и `provenance.json` для доверенного оценщика. |
| `data/trajectories.jsonl` | Траектории RandomExplorer, SimpleReconciler и FlagAllAttack. |
| `data/dataset_version.json` | Версия корпуса и число эпизодов в каждом сплите. |

В каждом сплите есть два чистых эпизода, четыре независимых сценария, два сценария с взаимодействием и два смешанных эпизода. Последний dev-эпизод содержит 2 000 строк книги, 200 документов и 12 эталонных ошибок.

Для проверки агента используйте изолированный интерфейс и передавайте ему только ответы `reset` и `step`. Папки `private`, код генерации контрольного набора и готовые траектории предназначены для судейского прогона.

## JSON API

Интерфейс следует форме Gymnasium. `reset(seed, config)` возвращает `(observation, info)`, а `step(action)` возвращает `(observation, reward, terminated, truncated, info)`. Для существующего эпизода фасад загружает открытый каталог и принимает `reset(config=EnvConfig(...))`. Для нового эпизода используйте `IsolatedAuditEnv().reset(seed=42, config=GeneratorConfig(...))`. Фасад обрабатывает seed снаружи процесса среды.

```bash
PYTHONPATH=src python3.11 - <<'PY'
from audit_env.env.isolation import IsolatedAuditEnv

with IsolatedAuditEnv("data/dev/public/02") as env:
    observation, info = env.reset()
    episode_id = observation["manifest"]["episode_id"]
    page = env.step({"action": "list_records", "table": "invoices", "limit": 5})
    print(page)
    print(env.step({
        "action": "submit",
        "findings": {"episode_id": episode_id, "findings": []},
    }))
PY
```

| Действие | Поля | Результат |
|---|---|---|
| `list_records` | `table`, необязательные `cursor` и `limit` | До 50 строк в порядке файла и `next_cursor`. Начальный курсор `null`. |
| `get_record` | `table`, `id` | Строка по `row_id`, `invoice_id`, `payment_id` или возвращённому `rate_id`. |
| `get_document` | `doc_id` | Документ счёта или платежа. |
| `calculator` | `expression` | Строка Decimal, например `{"value":"0.3"}` для `0.1+0.2`. |
| `submit` | `findings` | Терминальный ответ. Лимиты составляют 30 выводов, 10 ID доказательств и 1 000 символов объяснения на вывод. |

Таблицы называются `ledger`, `invoices`, `payments` и `fx`. Код ограниченной ошибки находится в `observation.error.code`. Любая попытка исследования расходует шаг. На шаге 100 корректный `submit` ещё принимается. При истечении времени или исчерпании шагов без `submit` среда возвращает `truncated=True` и пустой итог.

Пример обёртки `submit`. Замените ID на значения из наблюдений конкретного эпизода.

```json
{
  "action": "submit",
  "findings": {
    "episode_id": "e-example",
    "findings": [
      {
        "type": "unallocated_payment",
        "affected_ids": ["pay-example"],
        "claimed_amount_minor": 12500,
        "currency": "USD",
        "evidence_ids": ["doc-example"],
        "explanation": "Сумма распределений меньше суммы платежа на 12500 центов."
      }
    ]
  }
}
```

| Тип | Сумма вывода | Доказательство |
|---|---|---|
| `duplicate_invoice` | Номинал счёта в его валюте | Оба документа с совпадающим номером поставщика в `line_items.source_ref`. |
| `unallocated_payment` | Нераспределённый остаток в валюте платежа | Документ платежа с суммой и распределениями. |
| `fx_mismatch` | Модуль расхождения в базовой валюте | Документ счёта, строка проводки, котировка на локальную дату события. |
| `cutoff_error` | Сумма кредитовой строки в базовой валюте | Исходный документ и кредитовая строка по другую сторону границы периода. |

## Оценка и повторная генерация

При исследовании и корректном `submit` среда возвращает `0.0`. Структурно неверный `submit` возвращает `−1.0` сразу. Оценщик после прогона вычисляет P, R, F1 и итоговую награду `clip(2 × F1 − 1 − 0.002 × inspection_steps, −1, 1)`. При пропуске `submit` итоговая награда оценщика равна `−1.0` и отправленные выводы отсутствуют. Допуск суммы по умолчанию составляет 0 минимальных единиц.

```bash
PYTHONPATH=src python3.11 -m audit_env.runner generate --data /tmp/fresh-audit-data
PYTHONPATH=src python3.11 -m audit_env.runner benchmark --trajectories /tmp/audit-rollouts.jsonl --judge-log /tmp/audit-judge.jsonl
```

Первую строку каждой траектории записывают с `step=0` и `action=null`. Судейский балл добавляется в терминальную строку после проверки. Показатели и статусы сохраняются через `--judge-log`, а эталонные действия Oracle остаются в судейском прогоне.

Подробности реализации, результаты замеров и ограничения приведены в [DESIGN_NOTE.md](DESIGN_NOTE.md).
