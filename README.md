# Isogeny Hub

A comprehensive overview of isogeny-based key exchange protocols, tracking their evolution from the original CSIDH proposal to modern implementations, along with detailed performance benchmarks across different security levels and implementations.

[https://ression.de](https://ression.de).

## Contributing

We welcome contributions to expand the database of isogeny-based key exchange protocols and their benchmarks. To contribute, please follow the JSON templates below:

### CSIDH Data Template
```json
{
  "id": "eprint - id",
  "title": "Paper Title",
  "short": "Short Name",
  "authors": "Author1, Author2, and Author3",
  "date": "YYYY-MM-DD",
  "eprint_link": "https://eprint.iacr.org/...",
  "abstract": "Paper abstract",
  "summary": "Brief summary of the paper's contribution",
  "based_on": [
    {
      "id": "eprint - id",
      "label": "relationship to previous work"
    }
  ],
  "tags": ["algorithm", "implementation", "..."]
}
```

### Benchmarks Template
```json
{
  "paper_id": "eprint - id",
  "benchmarks": [
    {
      "name": "Implementation Name",
      "operations": {
        "M": 0,
        "S": 0,
        "a": 0
      },
      "cycles": [
        {
          "platform": "CPU Architecture",
          "value": 0.0,
          "unit": "Gcyc"
        }
      ],
      "constant_time": false,
      "deterministic": false,
      "dummy_free": false,
      "size": 512,
      "keyspace": 256,
      "nist_level": "?"
    }
  ]
}
```
