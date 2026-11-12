import threading
import time
import unittest

from app.services import render_queue_service as queue
from app.services.job_service import get_job


class JobRetry(unittest.TestCase):
    def test_a_failed_job_runs_again_under_the_same_id(self):
        runs = []

        def work(should_cancel):
            runs.append(1)
            if len(runs) == 1:
                raise RuntimeError('first try fails')
            return {'progress': 100}

        job_id = queue.enqueue_render('effect', 'Retry test', work)
        for _ in range(100):
            if (get_job(job_id) or {}).get('done'):
                break
            time.sleep(0.05)
        self.assertEqual(get_job(job_id)['status'], 'failed')
        self.assertTrue(queue.can_retry(job_id))
        self.assertTrue(queue.retry(job_id))
        for _ in range(100):
            job = get_job(job_id)
            if job.get('done') and job.get('status') != 'queued':
                break
            time.sleep(0.05)
        self.assertEqual(get_job(job_id)['status'], 'done')
        self.assertEqual(len(runs), 2)
        self.assertFalse(queue.can_retry(job_id))  # Done: nothing kept.
        self.assertFalse(queue.retry(job_id))


if __name__ == '__main__':
    unittest.main()
