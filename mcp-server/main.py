from mcp.server.fastmcp import FastMCP
from dotenv import load_dotenv
import httpx
import json
import os
from bs4 import BeautifulSoup
import logging

# Load environment variables
load_dotenv()

# Initialize logging
logging.basicConfig(
  level=logging.INFO,
  format="%(asctime)s - %(levelname)s - %(message)s",
  handlers=[logging.StreamHandler()]
)

# Initialize FastMCP
mcp = FastMCP("docs")

# Constants
USER_AGENT = "docs-app/1.0"
SERPER_URL = "https://google.serper.dev/search"

# Supported documentation URLs
docs_urls = {
  "langchain": "python.langchain.com/docs",
  "llama-index": "docs.llamaindex.ai/en/stable",
  "openai": "platform.openai.com/docs",
}

async def search_web(query: str) -> dict | None:
  """
  Perform a web search using the SERPER API.

  Args:
    query (str): The search query.

  Returns:
    dict | None: The JSON response from the SERPER API or None in case of an error.
  """
  logging.info(f"Initiating web search for query: {query}")
  payload = json.dumps({"q": query, "num": 2})

  headers = {
    "X-API-KEY": os.getenv("SERPER_API_KEY"),
    "Content-Type": "application/json",
  }

  async with httpx.AsyncClient() as client:
    try:
      response = await client.post(
        SERPER_URL, headers=headers, data=payload, timeout=30.0
      )
      response.raise_for_status()
      logging.info(f"Search successful for query: {query}")
      return response.json()
    except httpx.TimeoutException:
      logging.error(f"Timeout occurred during search for query: {query}")
      return {"organic": []}
    except httpx.RequestError as e:
      logging.error(f"Request error during search for query: {query} - {e}")
      return None

async def fetch_url(url: str) -> str:
  """
  Fetch the content of a URL and extract its text.

  Args:
    url (str): The URL to fetch.

  Returns:
    str: The extracted text from the URL or an error message in case of failure.
  """
  logging.info(f"Fetching URL: {url}")
  async with httpx.AsyncClient() as client:
    try:
      response = await client.get(url, timeout=30.0)
      response.raise_for_status()
      soup = BeautifulSoup(response.text, "html.parser")
      text = soup.get_text()
      logging.info(f"Successfully fetched and parsed URL: {url}")
      return text
    except httpx.TimeoutException:
      logging.error(f"Timeout occurred while fetching URL: {url}")
      return "Timeout error"
    except httpx.RequestError as e:
      logging.error(f"Request error while fetching URL: {url} - {e}")
      return "Request error"

@mcp.tool()
async def get_docs(query: str, library: str) -> str:
  """
  Search the latest documentation for a given query and library.

  Args:
    query (str): The query to search for (e.g., "Chroma DB").
    library (str): The library to search in (e.g., "langchain").

  Returns:
    str: The text from the documentation or an error message if no results are found.
  """
  logging.info(f"get_docs called with query: '{query}' and library: '{library}'")
  if library not in docs_urls:
    error_message = f"Library {library} not supported by this tool"
    logging.error(error_message)
    raise ValueError(error_message)

  # Construct the search query
  query = f"site:{docs_urls[library]} {query}"
  logging.info(f"Constructed search query: {query}")

  # Perform the web search
  results = await search_web(query)
  if not results or len(results.get("organic", [])) == 0:
    logging.warning(f"No results found for query: {query}")
    return "No results found"

  # Fetch and aggregate text from the search results
  text = ""
  for result in results["organic"]:
    logging.info(f"Processing result: {result['link']}")
    text += await fetch_url(result["link"])
  logging.info(f"Completed fetching documentation for query: '{query}'")
  return text

if __name__ == "__main__":
  logging.info("Starting MCP server...")
  mcp.run(transport="stdio")
