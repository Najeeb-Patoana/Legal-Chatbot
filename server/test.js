require("dotenv").config();

(async () => {
  const res = await fetch(
    process.env.QDRANT_URL + "/collections",
    {
      headers: {
        "api-key": process.env.QDRANT_API_KEY,
      },
    }
  );

  console.log(res.status);
  console.log(await res.text());
})();