# Contract: what pdf-export asks of the analysis service

The analysis service's public API, under `/AnalysisService`, called directly (not
through the gateway). Research R1 says why these and not others.

| Call | Request                                                                                                               | Used for                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1    | `GET /token/{token}?resource={R}&importableOnly={B}&includeDisease=true` (no page)                                    | the summary, resources, not-found count, expression columns, and every filtered pathway in the default sort |
| 2    | `POST /token/{token}/found/all?resource=TOTAL`, body: call 1's pathway ids, one per line                              | each pathway's found entities and interactors; the identifiers found                                        |
| 3    | `GET /token/{token}/notFound` (no page)                                                                               | the identifiers not found                                                                                   |
| 4    | `GET /token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true`, only when R is not `TOTAL` or B is true | the unfiltered reactions' columns, if the measurement shows they differ                                     |

**Answers relied on.**

- 404 for an unknown token, 410 for one a release deleted: passed on in the report's
  JSON form (contracts/service.md).
- Call 2 answers 404 when no pathway matches: a result with nothing found, not an
  error.
- Any other failure, or no answer within the stage's time: the report is answered 503.

**The species** is passed by its taxonomy id, resolved from the graph.
