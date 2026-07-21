const Groq = require("groq-sdk");
require("dotenv").config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

(async () => {
  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", // or another model available to your account
      messages: [
        {
          role: "user",
          content: "Say hello",
        },
      ],
    });

    console.log(response.choices[0].message.content);
  } catch (err) {
    console.error(err);
  }
})();