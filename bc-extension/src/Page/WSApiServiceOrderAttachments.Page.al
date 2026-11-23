/// <summary>
/// Attachments of service orders. The Monteur-App sends the workshop order signed by the customer
/// (PDF, Base64 in fileContent) when the work is finished. The file is stored with the standard
/// "Document Attachment" mechanism on the service order (factbox "Attachments"). Idempotent via monteurAppId.
/// </summary>
page 50117 "WS API Service Order Attachments"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceOrderAttachment';
    EntitySetName = 'serviceOrderAttachments';
    EntityCaption = 'Service Order Attachment';
    EntitySetCaption = 'Service Order Attachments';
    SourceTable = "Document Attachment";
    SourceTableView = where("Table ID" = const(5900));
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = true;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Editable = false; }
                field(monteurAppId; Rec."Monteur App Id") { }
                field(documentNumber; Rec."No.") { }
                field(fileName; FileNameWithExtension) { }
                field(fileContent; FileContentBase64) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";
        FileNameWithExtension: Text[250];
        FileContentBase64: Text;

    trigger OnAfterGetRecord()
    begin
        FileNameWithExtension := CopyStr(Rec."File Name" + '.' + Rec."File Extension", 1, MaxStrLen(FileNameWithExtension));
        Clear(FileContentBase64); // never read back – the content stays in BC
    end;

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        Existing: Record "Document Attachment";
        ServiceHeader: Record "Service Header";
        TempBlob: Codeunit "Temp Blob";
        Base64: Codeunit "Base64 Convert";
        RecRef: RecordRef;
        OutStr: OutStream;
        InStr: InStream;
        AppId: Guid;
    begin
        ApiHelper.RequireMonteurAppId(Rec."Monteur App Id");
        AppId := Rec."Monteur App Id";

        Existing.SetRange("Monteur App Id", AppId);
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;

        ServiceHeader.Get(ServiceHeader."Document Type"::Order, Rec."No.");
        if FileContentBase64 = '' then
            Error('fileContent is required');

        TempBlob.CreateOutStream(OutStr);
        Base64.FromBase64(FileContentBase64, OutStr);
        TempBlob.CreateInStream(InStr);
        RecRef.GetTable(ServiceHeader);

        Existing.Init();
        Existing.SaveAttachmentFromStream(InStr, RecRef, FileNameWithExtension);
        Existing."Monteur App Id" := AppId;
        Existing.Modify(true);
        Rec := Existing;
        exit(false);
    end;
}
