/// <summary>
/// Adds the idempotency key of the Monteur-App to "Document Attachment" (signed workshop order as PDF).
/// </summary>
tableextension 50106 "WS Document Attachment" extends "Document Attachment"
{
    fields
    {
        field(50100; "Monteur App Id"; Guid)
        {
            Caption = 'Monteur-App-ID';
            DataClassification = SystemMetadata;
        }
    }

    keys
    {
        key(WSMonteurAppId; "Monteur App Id")
        {
        }
    }
}
