"""Read-only replay of locally retained captures. Usage: python3 analyze.py [raw-results-root]. Writes evidence.json beside this script. Raw captures are intentionally not committed."""
import collections
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import sys

HERE = Path(__file__).resolve().parent
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else HERE.parents[1]/'results/supa-desktop-native-v0.14.1-20261118'

def read(p):
    return json.loads(p.read_text())

def describe(a):
    if not a:
        return None
    a = sorted(a)
    def percentile(p):
        v = (len(a)-1)*p
        i = int(v)
        return a[i] + (a[min(i+1,len(a)-1)]-a[i])*(v-i)
    return dict(count=len(a), mean=statistics.fmean(a), p50=percentile(.5), p95=percentile(.95), p99=percentile(.99), maximum=a[-1])

out = dict(createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), method="HTTP timings: request_phase=measurement (fallback phase), traffic=backend, raw k6 Point metrics; milliseconds; linear interpolation percentiles. Completion may be after window end. HTTP request counts differ from logical action counts. DB deltas: project-labelled first/last cached metric snapshots, not exact measurement boundaries.", trials=[], sourceHashes={})
for t in read(ROOT/'RESULTS.json')['trials']:
    d = ROOT / Path(t['measurementAudit']).parent.name
    gateway = read(d/'gateway-load-audit.json')
    pg = read(d/'project-metrics-audit.json')
    audit = read(d/'measurement-audit.json')
    metrics = collections.defaultdict(lambda: collections.defaultdict(list))
    buckets = collections.defaultdict(list)
    with gzip.open(d/'k6-metrics.json.gz','rt') as f:
        for line in f:
            row = json.loads(line)
            name = row.get('metric','')
            if row.get('type') != 'Point' or not name.startswith('http_req_') or name == 'http_req_failed':
                continue
            point = row['data']
            tags = point.get('tags',{})
            if tags.get('request_phase',tags.get('phase')) != 'measurement' or tags.get('traffic') != 'backend':
                continue
            status = tags.get('status','unknown')
            group = '2xx' if status.startswith('2') else status
            metrics[group][name].append(point['value'])
            if name == 'http_req_duration' and group == '2xx':
                epoch = datetime.datetime.fromisoformat(point['time']).timestamp()*1000
                bucket = int((epoch-gateway['capture']['measurementWindow']['measurementAt'])//10000)
                buckets[bucket].append(point['value'])
    series = {}
    for k,v in pg['series'].items():
        if any(x in v['name'] for x in ['wal_', 'checkpoint', 'io_reads', 'io_writes', 'tracked_statement', 'connections', 'pg_stat_database_', 'pg_stat_bgwriter_']):
            series[k] = v
    h = {}
    for name in ['k6-metrics.json.gz','measurement-audit.json','gateway-load-audit.json','project-metrics-audit.json','additional-diagnostics.jsonl']:
        p = d/name
        if p.exists():
            h[str(p.relative_to(ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
    out['sourceHashes'].update(h)
    out['trials'].append(dict(users=t['users'], directory=d.name, result=t,
        successfulActionsPerSecond=(t['actions']-t['failedActions'])/120,
        rawHttp={g:{n:describe(a) for n,a in m.items()} for g,m in metrics.items()},
        successfulHttpCompletedPerSecond=len(metrics['2xx']['http_req_duration'])/120,
        successfulHttpTenSecondBuckets={str(k):describe(v) for k,v in sorted(buckets.items())},
        phaseHttpStatusCounts=audit['httpStatusCounts'], gateway=gateway,
        projectDatabaseSeries=series, projectTimedSamples=pg['timedSamples']))
def public_paths(value):
    if isinstance(value,str):
        return value.replace(str(ROOT)+'/', 'raw-results/').replace(str(ROOT.parent.parent)+'/', '')
    if isinstance(value,list):
        return [public_paths(x) for x in value]
    if isinstance(value,dict):
        return {k:public_paths(v) for k,v in value.items()}
    return value
(HERE/'evidence.json').write_text(json.dumps(public_paths(out),indent=2)+'\n')
for t in out['trials']:
    print(t['users'], 'success-actions/s',round(t['successfulActionsPerSecond'],2),'success-http/s',round(t['successfulHttpCompletedPerSecond'],2))
    for g,m in t['rawHttp'].items():
        print(g,{n.replace('http_req_',''): {k:round(v,3) for k,v in a.items() if k in ['count','mean','p95']} for n,a in m.items() if n in ['http_req_duration','http_req_waiting','http_req_receiving','http_req_connecting','http_req_blocked']})
