from flask import Flask, jsonify, make_response, request

app = Flask(__name__)


@app.route("/api/test", methods=["GET", "POST", "OPTIONS"])
def test_endpoint():
    if request.method == "OPTIONS":
        response = make_response()
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response
    elif request.method == "GET":
        return jsonify({"message": "GET request received"})
    elif request.method == "POST":
        data = request.get_json()
        return jsonify({"message": "POST request received", "data": data})


# Add both Allow and Access-Control-Allow-Methods headers to all responses
@app.after_request
def add_allow_headers(response):
    # Add standard Allow header (for non-CORS clients)
    response.headers["Allow"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


# Add this section to run the server when the script is executed directly
if __name__ == "__main__":
    print("Starting Flask test server for MethodCheck on http://localhost:5000")
    print("Available endpoint: http://localhost:5000/api/test")
    app.run(host="0.0.0.0", port=5000, debug=True)
