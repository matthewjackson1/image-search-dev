const OpenAI = require("openai");
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG,
  project: process.env.OPENAI_PROJECT,
});

// Function to encode the image
const encodeImage = (imagePath) => {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
};

// Path to your image
const imagePath = path.resolve('./images/image_789.jpeg');

// Getting the base64 string
const base64Image = encodeImage(imagePath);

async function main() {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { 
            type: "text",
            text: "I am creating an image search engine for my website to help users find similar products based on their uploaded photos. We primarily sell knitting and crochet patterns, so our product images mostly feature either the garment/project itself or a model wearing it. I need an array of descriptive labels for these images - this can also include vocabulary that users might use when searching. The labels should detail the knitted/crocheted garment or project, including aspects like style, theme, construction, and type of garment. This will make search results more relevant. For the example knitting pattern photo I'm uploading, please provide a detailed JavaScript array of strings with these labels. Respond only with the array in the format: ['label1', 'label2', 'label3']." },
          {
            type: "image_url",
            image_url: {
              "url": `data:image/jpeg;base64,${base64Image}`,
              "detail": "low"
            },
          },
        ],
      },
    ],
  });
  console.log(response.choices[0].message.content);
}
main();