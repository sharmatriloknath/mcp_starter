import logging
from mcp.server.fastmcp import FastMCP
from dotenv import load_dotenv
import httpx
import json
import os
from bs4 import BeautifulSoup

# Configure logging
logging.basicConfig(
  level=logging.DEBUG,
  format="%(asctime)s - %(levelname)s - %(message)s",
  handlers=[logging.StreamHandler()]
)

load_dotenv()

mcp = FastMCP("docs")

USER_AGENT = "docs-app/1.0"
SERPER_URL = "https://google.serper.dev/search"

docs_urls = {
  "langchain": "python.langchain.com/docs",
  "llama-index": "docs.llamaindex.ai/en/stable",
  "openai": "platform.openai.com/docs",
}

async def search_web(query: str) -> dict | None:
  logging.debug(f"Initiating web search with query: {query}")
  payload = json.dumps({"q": query, "num": 2})

  headers = {
    "X-API-KEY": os.getenv("SERPER_API_KEY"),
    "Content-Type": "application/json",
  }

  async with httpx.AsyncClient() as client:
    try:
      logging.debug(f"Sending POST request to {SERPER_URL} with payload: {payload}")
      response = await client.post(
        SERPER_URL, headers=headers, data=payload, timeout=30.0
      )
      response.raise_for_status()
      logging.info(f"Search successful for query: {query}")
      return response.json()
    except httpx.TimeoutException:
      logging.error(f"Timeout occurred while searching for query: {query}")
      return {"organic": []}
    except httpx.RequestError as e:
      logging.error(f"Request error occurred: {e}")
      return {"organic": []}

async def fetch_url(url: str):
  logging.debug(f"Fetching URL: {url}")
  async with httpx.AsyncClient() as client:
    try:
      response = await client.get(url, timeout=30.0)
      soup = BeautifulSoup(response.text, "html.parser")
      text = soup.get_text()
      logging.info(f"Successfully fetched content from URL: {url}")
      return text
    except httpx.TimeoutException:
      logging.error(f"Timeout occurred while fetching URL: {url}")
      return "Timeout error"
    except httpx.RequestError as e:
      logging.error(f"Request error occurred while fetching URL: {url} - {e}")
      return "Request error"

@mcp.tool()
async def get_docs(query: str, library: str):
  """
  Search the latest docs for a given query and library.
  Supports langchain, openai, and llama-index.

  Args:
    query: The query to search for (e.g. "Chroma DB")
    library: The library to search in (e.g. "langchain")

  Returns:
    Text from the docs
  """
  logging.debug(f"get_docs called with query: {query}, library: {library}")
  if library not in docs_urls:
    logging.error(f"Library {library} not supported by this tool")
    raise ValueError(f"Library {library} not supported by this tool")
  
  query = f"site:{docs_urls[library]} {query}"
  logging.debug(f"Formatted query for search: {query}")
  results = await search_web(query)
  if len(results["organic"]) == 0:
    logging.warning(f"No results found for query: {query}")
    return "No results found"
  
  text = ""
  for result in results["organic"]:
    logging.debug(f"Processing result: {result['link']}")
    text += await fetch_url(result["link"])
  logging.info(f"Completed fetching docs for query: {query}, library: {library}")
  return text

if __name__ == "__main__":
  logging.info("Starting MCP server...")
  mcp.run(transport="stdio")
