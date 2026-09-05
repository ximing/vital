/**
 * One-shot bucket lifecycle:
 * - {prefix}/tmp/ expires after 7d
 * - AbortIncompleteMultipartUpload after 7d
 * IDs: vital-tmp-expire-7d, vital-abort-incomplete-multipart-7d
 */
import {
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { config } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

const endpoint = config.ATTACHMENT_S3_ENDPOINT;
const isAliyunOSS =
  endpoint?.includes(config.ATTACHMENT_S3_REGION) === true ||
  endpoint?.includes('aliyuncs') === true;
const clientConfig: S3ClientConfig = {
  region: config.ATTACHMENT_S3_REGION,
  credentials: {
    accessKeyId: config.ATTACHMENT_S3_ACCESS_KEY_ID,
    secretAccessKey: config.ATTACHMENT_S3_SECRET_ACCESS_KEY,
  },
};
if (endpoint) {
  clientConfig.endpoint = endpoint;
  clientConfig.forcePathStyle = !isAliyunOSS;
}
const client = new S3Client(clientConfig);

const tmpPrefix = `${config.ATTACHMENT_S3_PREFIX}/tmp/`;

await client.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: config.ATTACHMENT_S3_BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'vital-tmp-expire-7d',
          Status: 'Enabled',
          Filter: { Prefix: tmpPrefix },
          Expiration: { Days: 7 },
        },
        {
          ID: 'vital-abort-incomplete-multipart-7d',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ],
    },
  }),
);

logger.info('bucket lifecycle configured', { bucket: config.ATTACHMENT_S3_BUCKET, tmpPrefix });
