# Contract: what pdf-export asks of the analysis service

The analysis service's public API, under `/AnalysisService`, called directly (not
through the gateway). Research R1 says why these and not others.

In this order (research R1):

| Call | Request                                                                                                                                           | Used for                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GET /token/{token}/resources`                                                                                                                    | the result's resources, to decide the report's resource                                                                                   |
| 2    | `GET /token/{token}?resource={R}&importableOnly={B}&includeDisease=true` (no page, no species)                                                    | the summary (with the ReactomeGSA method), resources, not-found count, expression columns, and every filtered pathway in the default sort |
| 3    | `GET /token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true`, only when R is not `TOTAL` or B is true                             | the reactions' columns as today's report shows them                                                                                       |
| 4    | `POST /token/{token}/found/all?resource=TOTAL`, `Content-Type: text/plain`, body: call 2's pathway ids, one per line; skipped when there are none | each pathway's found entities and interactors; the identifiers found                                                                      |
| 5    | `GET /token/{token}/notFound` (no page)                                                                                                           | the identifiers not found                                                                                                                 |

**Answers relied on.**

- 404 for an unknown token, 410 for one a release deleted: passed on in the report's
  JSON form (contracts/service.md).
- Call 4 is not made when call 2 has no pathway: the service cannot take an empty
  body.
- Any other failure, or no answer within the stage's time: the report is answered 503.

**The species** is not passed: it picks call 2's pathways by their species, resolved
from the graph, and today's counts span every species.
