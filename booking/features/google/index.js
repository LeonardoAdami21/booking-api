// ===== ARQUIVO: setup-gcs.js =====
import { Storage } from "@google-cloud/storage";
import * as dotenv from "dotenv";

dotenv.config();

async function setupGCS() {
  try {
    console.log("🚀 Configurando Google Cloud Storage...");

    const storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    });

    const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
    const bucket = storage.bucket(bucketName);

    // Verificar se o bucket existe
    const [exists] = await bucket.exists();

    if (!exists) {
      console.log(`📦 Criando bucket: ${bucketName}`);
      await storage.createBucket(bucketName, {
        location: "US-CENTRAL1",
        storageClass: "STANDARD",
      });
      console.log("✅ Bucket criado com sucesso!");
    } else {
      console.log("✅ Bucket já existe!");
    }

    // Criar estrutura de pastas
    const folders = ["reservations/"];

    for (const folder of folders) {
      const file = bucket.file(`${folder}.gitkeep`);
      const [exists] = await file.exists();

      if (!exists) {
        await file.save("");
        console.log(`📁 Pasta criada: ${folder}`);
      }
    }

    console.log("🎉 Setup do GCS concluído!");
  } catch (error) {
    console.error("❌ Erro no setup:", error.message);
  }
}

setupGCS();

class GCSClient {
  constructor() {
    this.storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    });

    this.bucket = this.storage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME);
  }

  // Upload de arquivo
  async uploadFile(fileBuffer, originalName, folder = "uploads") {
    try {
      const fileName = `${folder}/${uuidv4()}-${originalName}`;
      const file = this.bucket.file(fileName);

      const mimeType = mime.lookup(originalName) || "application/octet-stream";

      await file.save(fileBuffer, {
        metadata: {
          contentType: mimeType,
        },
      });

      // Tornar público (opcional)
      await file.makePublic();

      return {
        success: true,
        fileName,
        publicUrl: `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET_NAME}/${fileName}`,
        size: fileBuffer.length,
        contentType: mimeType,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Salvar JSON
  async saveJSON(data, fileName, folder = "data") {
    try {
      const fullPath = `${folder}/${fileName}.json`;
      const file = this.bucket.file(fullPath);

      await file.save(JSON.stringify(data, null, 2), {
        metadata: {
          contentType: "application/json",
        },
      });

      return { success: true, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default GCSClient;
