const { OpenAI } = require("openai");
require("dotenv").config();

const client = new OpenAI({
  apiKey: process.env.GPT_API_KEY,
});

(async () => {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "user",
          content: "Say hello in one sentence.",
        },
      ],
    });

    console.log("Response:");
    console.log(response.choices[0].message.content);
  } catch (err) {
    console.error("Error:", err.status || "");
    console.error(err.message);

    if (err.error) {
      console.error(err.error);
    }
  }
})();