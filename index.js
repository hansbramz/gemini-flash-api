const express = require('express');
const dotenv = require('dotenv');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables from .env file
dotenv.config();

const app = express();
// Enable JSON body parsing for incoming requests
app.use(express.json());

// Initialize Google Generative AI with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Get the generative model (gemini-1.5-flash is used here)
const model = genAI.getGenerativeModel({ model: 'models/gemini-1.5-flash' });

// Configure multer for file uploads, storing files in the 'uploads/' directory
const upload = multer({ dest: 'uploads/' });

// Define the port the server will listen on
const PORT = 3000;

// Start the server and log a message to the console
app.listen(PORT, () => {
    console.log(`Gemini API server is running at http://localhost:${PORT}`);
});

/**
 * Converts an image file path into a Generative AI compatible part.
 * Reads the image file, converts it to a base64 string, and determines its MIME type.
 * @param {string} imagePath - The path to the image file.
 * @returns {object} An object with inlineData containing the base64 image data and MIME type.
 */
function imageToGenerativePart(imagePath) {
    // Read the image file synchronously
    const imageBuffer = fs.readFileSync(imagePath);
    // Convert the image buffer to a base64 string
    const base64ImageData = imageBuffer.toString('base64');
    // Determine the MIME type based on the file extension
    const mimeType = getMimeType(imagePath);

    return {
        inlineData: {
            data: base64ImageData,
            mimeType
        },
    };
}

/**
 * Determines the MIME type of a file based on its extension.
 * This function is crucial for multi-modal requests with Gemini API.
 * @param {string} filePath - The path to the file.
 * @returns {string} The MIME type of the file.
 */
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif'; // Ensure .gif is correctly mapped
        case '.webp':
            return 'image/webp';
        // Add more image types if needed
        default:
            // Log a warning if the MIME type is not explicitly handled
            console.warn(`Warning: Unrecognized file extension "${ext}". Defaulting to "application/octet-stream".`);
            return 'application/octet-stream'; // This should ideally not be reached for common image types
    }
}

// Endpoint for generating text from a prompt
app.post('/generate-text', async (req, res) => {
    const { prompt } = req.body; // Extract the prompt from the request body

    try {
        // Call the Generative AI model to generate content based on the prompt
        const result = await model.generateContent(prompt);
        // Get the response from the generated content
        const response = await result.response;
        // Send the generated text as a JSON response
        res.json({ output: response.text() });
    } catch (error) {
        // Log the error for debugging purposes
        console.error('Error generating text:', error);
        // Send a 500 status code with the error message
        res.status(500).json({ error: error.message });
    }
});

// Endpoint for generating text from an image and a prompt
app.post('/generate-from-image', upload.single('image'), async (req, res) => {
    // Get the prompt from the request body or use a default description
    const prompt = req.body.prompt || 'Describe the image';

    // Check if an image file was uploaded by multer
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
    }

    try {
        // Check the MIME type that Multer actually detected for the uploaded file
        // Multer usually populates req.file.mimetype with the correct type.
        const detectedMimeType = req.file.mimetype;
        console.log(`Multer detected MIME type: ${detectedMimeType}`);

        // If Multer's detected MIME type is more accurate, use it.
        // Otherwise, fall back to our getMimeType function (which we've now ensured is correct for GIFs)
        const mimeTypeForGemini = detectedMimeType; // Rely on Multer's detection first

        // It's a good idea to ensure the MIME type is one that Gemini 1.5 Flash supports for vision
        // Supported types typically include image/png, image/jpeg, image/gif, image/webp.
        const supportedImageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

        if (!supportedImageMimeTypes.includes(mimeTypeForGemini)) {
            // If Multer somehow provides an unsupported MIME type, log and reject
            console.error(`Unsupported MIME type detected by Multer: ${mimeTypeForGemini}`);
            return res.status(400).json({ error: `Unsupported image format. Detected: ${mimeTypeForGemini}. Supported: ${supportedImageMimeTypes.join(', ')}` });
        }


        // Convert the uploaded image file to a Generative AI compatible part
        const imagePart = {
            inlineData: {
                data: fs.readFileSync(req.file.path).toString('base64'),
                mimeType: mimeTypeForGemini // Use the validated MIME type
            },
        };

        // Call the Generative AI model to generate content based on the prompt and image
        const result = await model.generateContent([prompt, imagePart]);
        // Get the response from the generated content
        const response = await result.response;
        // Send the generated text as a JSON response
        res.json({ output: response.text() });

    } catch (error) {
        // Log the error for debugging purposes
        console.error('Error generating from image:', error);
        // Check if the error is from GoogleGenerativeAI and extract message
        if (error.message.includes('GoogleGenerativeAI Error')) {
            return res.status(500).json({ error: `AI Generation Error: ${error.message}` });
        }
        // Send a 500 status code with the error message for other errors
        res.status(500).json({ error: error.message });
    } finally {
        // Ensure the uploaded temporary file is deleted, regardless of success or failure
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log(`Deleted temporary file: ${req.file.path}`);
        }
    }
});

app.post('/generate-from-document', upload.single('document'), async (req, res) => {
    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);
    const base64Data = buffer.toString('base64');
    const mimeType = req.file.mimetype;

    try {
        const documentPart = {
            inlineData: { data: base64Data, mimeType }
        };

        const result = await model.generateContent(['Analyze this document:', documentPart]);
        const response = await result.response;
        res.json({ output: response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        fs.unlinkSync(filePath);
    }
});

app.post('/generate-from-audio', upload.single('audio'), async (req, res) => {
    const audioBuffer = fs.readFileSync(req.file.path);
    const base64Audio = audioBuffer.toString('base64');
    const audioPart = {
        inlineData: {
            data: base64Audio,
            mimeType: req.file.mimetype
        }
    };

    try {
        const result = await model.generateContent([
            'Transcribe or analyze the following audio:', audioPart
        ]);
        const response = await result.response;
        res.json({ output: response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        fs.unlinkSync(req.file.path);
    }
});