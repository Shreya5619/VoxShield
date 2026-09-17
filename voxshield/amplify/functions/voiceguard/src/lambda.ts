import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TranscribeClient, StartTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import { v4 as uuidv4 } from "uuid";

const s3 = new S3Client({});
const transcribe = new TranscribeClient({});

export const handler = async (event: any): Promise<any> => {
  console.log("Received event:", JSON.stringify(event));

  // Check if this is an S3 upload event or API Gateway event
  if (eventRecords && eventRecords.length > 0 && eventRecords[0].s3) {
    // S3 Event - audio already uploaded
    return handleS3Event(event);
  } else {
    // API Gateway Event - audio passed in body
    return handleApiEvent(event);
  }
};

const handleS3Event = async (event: any): Promise<any> => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));

  console.log(`Bucket: ${bucket}, Key: ${key}`);

  const jobName = `voiceguard-${uuidv4()}`;
  const mediaUri = `s3://${bucket}/${key}`;

  console.log(`Starting transcription: ${jobName}`);

  const command = new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: mediaUri },
    MediaFormat: "mp3",
    LanguageCode: "en-US",
  });

  await transcribe.send(command);

  return {
    statusCode: 200,
    body: JSON.stringify({ jobName, bucket, key }),
  };
};

const handleApiEvent = async (event: any): Promise<any> => {
  const body = JSON.parse(event.body || "{}");
  
  const audioBase64 = body.audio || "";
  const filename = body.filename || `recording-${uuidv4()}.mp3`;
  const callerType = body.callerType || "unknown";

  const bucketName = "voxshield";
  const s3Key = `recordings/${callerType}/${filename}`;

  console.log(`Uploading to s3://${bucketName}/${s3Key}`);

  const audioBytes = Buffer.from(audioBase64, "base64");

  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    Body: audioBytes,
    ContentType: "audio/mpeg",
  });

  await s3.send(putCommand);
  console.log("Audio uploaded to S3");

  // Start transcription
  const jobName = `voiceguard-${uuidv4()}`;
  const mediaUri = `s3://${bucketName}/${s3Key}`;

  console.log(`Starting transcription: ${jobName}`);

  const transcribeCommand = new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: mediaUri },
    MediaFormat: "mp3",
    LanguageCode: "en-US",
  });

  await transcribe.send(transcribeCommand);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      message: "Audio uploaded and transcription started",
      s3Key,
      jobName,
      callerType,
    }),
  };
};